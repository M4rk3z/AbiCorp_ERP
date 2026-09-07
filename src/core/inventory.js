export class InventoryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MOVEMENT_PREFIX = {
  entry: "ENT-",
  exit: "SAL-",
  transfer: "TRA-",
  adjustment: "AJU-",
  count: "CON-",
};

export function inventoryOptions(db) {
  return {
    items: db.prepare(`SELECT i.id, i.sku, i.name, i.standard_cost, u.symbol
      FROM items i LEFT JOIN units_of_measure u ON u.id = i.unit_id
      WHERE i.is_active = 1 AND i.inventory_tracked = 1 ORDER BY i.name`).all(),
    warehouses: db.prepare(`SELECT w.id, w.code, w.name, b.name AS branch_name
      FROM warehouses w JOIN branches b ON b.id = w.branch_id
      WHERE w.is_active = 1 ORDER BY b.name, w.name`).all(),
    locations: listLocations(db, true),
    lots: listLots(db, true),
  };
}

export function listBalances(db) {
  return db.prepare(`SELECT b.id, b.item_id, i.sku, i.name AS item_name, i.min_stock, i.max_stock,
    u.symbol AS unit_symbol, b.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
    b.location_id, l.code AS location_code, l.name AS location_name, b.lot_id, lot.lot_number,
    b.quantity, b.reserved_quantity, (b.quantity - b.reserved_quantity) AS available_quantity,
    b.average_cost, b.updated_at
    FROM inventory_balances b
    JOIN items i ON i.id = b.item_id
    JOIN warehouses w ON w.id = b.warehouse_id
    LEFT JOIN units_of_measure u ON u.id = i.unit_id
    LEFT JOIN inventory_locations l ON l.id = b.location_id
    LEFT JOIN inventory_lots lot ON lot.id = b.lot_id
    WHERE b.quantity <> 0 OR b.reserved_quantity <> 0
    ORDER BY i.name, w.name, l.name, lot.lot_number`).all();
}

export function listMovements(db, type = null) {
  const where = type && MOVEMENT_PREFIX[type] ? "WHERE m.movement_type = ?" : "";
  return db.prepare(`SELECT m.*, i.sku, i.name AS item_name, u.symbol AS unit_symbol,
    fw.name AS from_warehouse_name, fl.name AS from_location_name,
    tw.name AS to_warehouse_name, tl.name AS to_location_name,
    lot.lot_number, s.serial_number, usr.full_name AS created_by_name
    FROM inventory_movements m
    JOIN items i ON i.id = m.item_id
    LEFT JOIN units_of_measure u ON u.id = i.unit_id
    LEFT JOIN warehouses fw ON fw.id = m.from_warehouse_id
    LEFT JOIN inventory_locations fl ON fl.id = m.from_location_id
    LEFT JOIN warehouses tw ON tw.id = m.to_warehouse_id
    LEFT JOIN inventory_locations tl ON tl.id = m.to_location_id
    LEFT JOIN inventory_lots lot ON lot.id = m.lot_id
    LEFT JOIN inventory_serials s ON s.id = m.serial_id
    LEFT JOIN users usr ON usr.id = m.created_by
    ${where} ORDER BY m.id DESC LIMIT 300`).all(...(where ? [type] : []));
}

export function postEntry(db, body, userId) {
  const data = cleanMovement(body, { needsTo: true, withCost: true });
  return transaction(db, () => postEntryWithinTransaction(db, data, userId));
}

export function postExit(db, body, userId) {
  const data = cleanMovement(body, { needsFrom: true });
  return transaction(db, () => postExitWithinTransaction(db, data, userId));
}

export function postEntryWithinTransaction(db, data, userId) {
  validateStockKey(db, data.itemId, data.toWarehouseId, data.toLocationId ?? null, data.lotId ?? null);
  changeBalance(db, {
    itemId: data.itemId, warehouseId: data.toWarehouseId, locationId: data.toLocationId ?? null,
    lotId: data.lotId ?? null, quantityDelta: Number(data.quantity), incomingCost: Number(data.unitCost ?? 0),
  });
  return insertMovement(db, { ...data, type: "entry", userId });
}

export function postExitWithinTransaction(db, data, userId) {
  validateStockKey(db, data.itemId, data.fromWarehouseId, data.fromLocationId ?? null, data.lotId ?? null);
  const balance = getBalance(db, data.itemId, data.fromWarehouseId, data.fromLocationId ?? null, data.lotId ?? null);
  if (!balance || balance.quantity - balance.reserved_quantity < Number(data.quantity))
    throw new InventoryError(409, "La existencia disponible no es suficiente para registrar la salida.");
  changeBalance(db, {
    itemId: data.itemId, warehouseId: data.fromWarehouseId, locationId: data.fromLocationId ?? null,
    lotId: data.lotId ?? null, quantityDelta: -Number(data.quantity),
  });
  return insertMovement(db, { ...data, type: "exit", unitCost: balance.average_cost, userId });
}

export function postTransfer(db, body, userId) {
  const data = cleanMovement(body, { needsFrom: true, needsTo: true });
  if (data.fromWarehouseId === data.toWarehouseId && nullableEqual(data.fromLocationId, data.toLocationId))
    throw new InventoryError(400, "El origen y el destino de la transferencia deben ser diferentes.");
  return transaction(db, () => {
    validateStockKey(db, data.itemId, data.fromWarehouseId, data.fromLocationId, data.lotId);
    validateStockKey(db, data.itemId, data.toWarehouseId, data.toLocationId, data.lotId);
    const source = getBalance(db, data.itemId, data.fromWarehouseId, data.fromLocationId, data.lotId);
    if (!source || source.quantity - source.reserved_quantity < data.quantity)
      throw new InventoryError(409, "La existencia disponible no es suficiente para la transferencia.");
    changeBalance(db, { itemId: data.itemId, warehouseId: data.fromWarehouseId, locationId: data.fromLocationId, lotId: data.lotId, quantityDelta: -data.quantity });
    changeBalance(db, { itemId: data.itemId, warehouseId: data.toWarehouseId, locationId: data.toLocationId, lotId: data.lotId, quantityDelta: data.quantity, incomingCost: source.average_cost });
    return insertMovement(db, { ...data, type: "transfer", unitCost: source.average_cost, userId });
  });
}

export function postAdjustment(db, body, userId) {
  const data = cleanMovement(body, { needsTo: true, signedQuantity: true, withCost: true });
  if (!data.reason) throw new InventoryError(400, "Indica el motivo del ajuste.");
  return transaction(db, () => {
    validateStockKey(db, data.itemId, data.toWarehouseId, data.toLocationId, data.lotId);
    const balance = getBalance(db, data.itemId, data.toWarehouseId, data.toLocationId, data.lotId);
    if (data.quantity < 0 && (!balance || balance.quantity - balance.reserved_quantity < Math.abs(data.quantity)))
      throw new InventoryError(409, "El ajuste dejaría una existencia disponible negativa.");
    const cost = data.unitCost || balance?.average_cost || itemCost(db, data.itemId);
    changeBalance(db, {
      itemId: data.itemId, warehouseId: data.toWarehouseId, locationId: data.toLocationId,
      lotId: data.lotId, quantityDelta: data.quantity, incomingCost: cost,
    });
    return insertMovement(db, {
      ...data, type: "adjustment", quantity: Math.abs(data.quantity), unitCost: cost, userId,
      fromWarehouseId: data.quantity < 0 ? data.toWarehouseId : null,
      fromLocationId: data.quantity < 0 ? data.toLocationId : null,
      toWarehouseId: data.quantity > 0 ? data.toWarehouseId : null,
      toLocationId: data.quantity > 0 ? data.toLocationId : null,
    });
  });
}

export function listReservations(db) {
  return db.prepare(`SELECT r.*, i.sku, i.name AS item_name, u.symbol AS unit_symbol,
    w.name AS warehouse_name, l.name AS location_name, lot.lot_number, usr.full_name AS created_by_name
    FROM inventory_reservations r JOIN items i ON i.id = r.item_id
    JOIN warehouses w ON w.id = r.warehouse_id
    LEFT JOIN units_of_measure u ON u.id = i.unit_id
    LEFT JOIN inventory_locations l ON l.id = r.location_id
    LEFT JOIN inventory_lots lot ON lot.id = r.lot_id
    LEFT JOIN users usr ON usr.id = r.created_by
    ORDER BY r.id DESC`).all();
}

export function createReservation(db, body, userId) {
  const itemId = positiveId(body.itemId, "artículo");
  const warehouseId = positiveId(body.warehouseId, "almacén");
  const locationId = optionalId(body.locationId, "ubicación");
  const lotId = optionalId(body.lotId, "lote");
  const quantity = positiveNumber(body.quantity, "La cantidad reservada");
  const reference = text(body.reference, 120);
  const requiredAt = optionalDate(body.requiredAt, "La fecha requerida");
  return transaction(db, () => {
    validateStockKey(db, itemId, warehouseId, locationId, lotId);
    const balance = getBalance(db, itemId, warehouseId, locationId, lotId);
    if (!balance || balance.quantity - balance.reserved_quantity < quantity)
      throw new InventoryError(409, "La existencia disponible no es suficiente para crear la reserva.");
    changeBalance(db, { itemId, warehouseId, locationId, lotId, reservedDelta: quantity });
    const result = db.prepare(`INSERT INTO inventory_reservations
      (folio, item_id, warehouse_id, location_id, lot_id, quantity, reference, required_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(placeholder("RES"), itemId, warehouseId, locationId, lotId, quantity, reference, requiredAt, userId);
    const id = Number(result.lastInsertRowid);
    const folio = autoFolio("RES-", id);
    db.prepare("UPDATE inventory_reservations SET folio = ? WHERE id = ?").run(folio, id);
    return { id, folio };
  });
}

export function releaseReservation(db, id) {
  return transaction(db, () => {
    const reservation = activeReservation(db, id);
    changeBalance(db, {
      itemId: reservation.item_id, warehouseId: reservation.warehouse_id, locationId: reservation.location_id,
      lotId: reservation.lot_id, reservedDelta: -reservation.quantity,
    });
    db.prepare("UPDATE inventory_reservations SET status = 'released', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    return { id, folio: reservation.folio };
  });
}

export function consumeReservation(db, id, userId) {
  return transaction(db, () => {
    const reservation = activeReservation(db, id);
    const balance = getBalance(db, reservation.item_id, reservation.warehouse_id, reservation.location_id, reservation.lot_id);
    if (!balance || balance.quantity < reservation.quantity || balance.reserved_quantity < reservation.quantity)
      throw new InventoryError(409, "La existencia reservada ya no está disponible.");
    changeBalance(db, {
      itemId: reservation.item_id, warehouseId: reservation.warehouse_id, locationId: reservation.location_id,
      lotId: reservation.lot_id, quantityDelta: -reservation.quantity, reservedDelta: -reservation.quantity,
    });
    const movement = insertMovement(db, {
      type: "exit", itemId: reservation.item_id, quantity: reservation.quantity,
      fromWarehouseId: reservation.warehouse_id, fromLocationId: reservation.location_id,
      toWarehouseId: null, toLocationId: null, lotId: reservation.lot_id, serialId: null,
      unitCost: balance.average_cost, reason: "Consumo de reserva", reference: reservation.folio,
      occurredAt: null, userId,
    });
    db.prepare("UPDATE inventory_reservations SET status = 'consumed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    return { id, folio: reservation.folio, movement };
  });
}

export function listLocations(db, activeOnly = false) {
  return db.prepare(`SELECT l.*, w.code AS warehouse_code, w.name AS warehouse_name, b.name AS branch_name
    FROM inventory_locations l JOIN warehouses w ON w.id = l.warehouse_id
    JOIN branches b ON b.id = w.branch_id ${activeOnly ? "WHERE l.is_active = 1 AND w.is_active = 1" : ""}
    ORDER BY w.name, l.name`).all();
}

export function createLocation(db, body) {
  const values = cleanLocation(body);
  validateWarehouse(db, values.warehouseId);
  return transaction(db, () => {
    try {
      const result = db.prepare(`INSERT INTO inventory_locations
        (code, warehouse_id, name, zone, aisle, rack, level, bin, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(placeholder("UBI"), values.warehouseId, values.name, values.zone, values.aisle, values.rack, values.level, values.bin, values.isActive);
      const id = Number(result.lastInsertRowid);
      const code = autoFolio("UBI-", id, 5);
      db.prepare("UPDATE inventory_locations SET code = ? WHERE id = ?").run(code, id);
      return { id, code };
    } catch (error) { constraint(error, "Ya existe una ubicación con ese nombre en el almacén."); }
  });
}

export function updateLocation(db, id, body) {
  const existing = db.prepare("SELECT * FROM inventory_locations WHERE id = ?").get(id);
  if (!existing) throw new InventoryError(404, "Ubicación no encontrada.");
  const values = cleanLocation(body);
  validateWarehouse(db, values.warehouseId);
  if (values.warehouseId !== existing.warehouse_id && db.prepare("SELECT 1 FROM inventory_balances WHERE location_id = ? LIMIT 1").get(id))
    throw new InventoryError(409, "No puedes cambiar de almacén una ubicación que ya tiene movimientos.");
  try {
    db.prepare(`UPDATE inventory_locations SET warehouse_id = ?, name = ?, zone = ?, aisle = ?, rack = ?, level = ?, bin = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(values.warehouseId, values.name, values.zone, values.aisle, values.rack, values.level, values.bin, values.isActive, id);
    return { id, code: existing.code };
  } catch (error) { constraint(error, "Ya existe una ubicación con ese nombre en el almacén."); }
}

export function listLots(db, activeOnly = false) {
  return db.prepare(`SELECT lot.*, i.sku, i.name AS item_name
    FROM inventory_lots lot JOIN items i ON i.id = lot.item_id
    ${activeOnly ? "WHERE lot.status = 'active' AND i.is_active = 1" : ""}
    ORDER BY lot.id DESC`).all();
}

export function createLot(db, body) {
  const itemId = positiveId(body.itemId, "artículo");
  validateItem(db, itemId);
  const requested = text(body.lotNumber, 80).toUpperCase();
  const manufacturingDate = optionalDate(body.manufacturingDate, "La fecha de fabricación");
  const expirationDate = optionalDate(body.expirationDate, "La fecha de caducidad");
  if (manufacturingDate && expirationDate && manufacturingDate > expirationDate) throw new InventoryError(400, "La caducidad no puede ser anterior a la fabricación.");
  const status = enumValue(body.status, ["active", "quarantine", "blocked", "expired"], "active");
  const notes = text(body.notes, 500);
  try {
    const result = db.prepare(`INSERT INTO inventory_lots (item_id, lot_number, manufacturing_date, expiration_date, status, notes)
      VALUES (?, ?, ?, ?, ?, ?)`).run(itemId, requested || placeholder("LOT"), manufacturingDate, expirationDate, status, notes);
    const id = Number(result.lastInsertRowid);
    const lotNumber = requested || autoFolio("LOT-", id, 6);
    if (!requested) db.prepare("UPDATE inventory_lots SET lot_number = ? WHERE id = ?").run(lotNumber, id);
    return { id, lotNumber };
  } catch (error) { constraint(error, "Ese lote ya existe para el artículo."); }
}

export function updateLot(db, id, body) {
  const existing = db.prepare("SELECT * FROM inventory_lots WHERE id = ?").get(id);
  if (!existing) throw new InventoryError(404, "Lote no encontrado.");
  const lotNumber = text(body.lotNumber ?? existing.lot_number, 80).toUpperCase();
  const manufacturingDate = optionalDate(body.manufacturingDate, "La fecha de fabricación");
  const expirationDate = optionalDate(body.expirationDate, "La fecha de caducidad");
  if (!lotNumber) throw new InventoryError(400, "El número de lote es obligatorio.");
  if (manufacturingDate && expirationDate && manufacturingDate > expirationDate) throw new InventoryError(400, "La caducidad no puede ser anterior a la fabricación.");
  const status = enumValue(body.status, ["active", "quarantine", "blocked", "expired"], existing.status);
  try {
    db.prepare(`UPDATE inventory_lots SET lot_number = ?, manufacturing_date = ?, expiration_date = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(lotNumber, manufacturingDate, expirationDate, status, text(body.notes, 500), id);
    return { id, lotNumber };
  } catch (error) { constraint(error, "Ese lote ya existe para el artículo."); }
}

export function listSerials(db) {
  return db.prepare(`SELECT s.*, i.sku, i.name AS item_name, lot.lot_number,
    w.name AS warehouse_name, l.name AS location_name
    FROM inventory_serials s JOIN items i ON i.id = s.item_id
    LEFT JOIN inventory_lots lot ON lot.id = s.lot_id
    LEFT JOIN warehouses w ON w.id = s.current_warehouse_id
    LEFT JOIN inventory_locations l ON l.id = s.current_location_id
    ORDER BY s.id DESC`).all();
}

export function createSerial(db, body) {
  const itemId = positiveId(body.itemId, "artículo");
  const lotId = optionalId(body.lotId, "lote");
  const warehouseId = optionalId(body.warehouseId, "almacén");
  const locationId = optionalId(body.locationId, "ubicación");
  validateItem(db, itemId);
  if (warehouseId) validateStockKey(db, itemId, warehouseId, locationId, lotId);
  else if (locationId) throw new InventoryError(400, "Selecciona el almacén de la ubicación.");
  const requested = text(body.serialNumber, 120).toUpperCase();
  const status = enumValue(body.status, ["available", "reserved", "issued", "blocked"], "available");
  try {
    const result = db.prepare(`INSERT INTO inventory_serials
      (item_id, serial_number, lot_id, status, current_warehouse_id, current_location_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(itemId, requested || placeholder("SER"), lotId, status, warehouseId, locationId, text(body.notes, 500));
    const id = Number(result.lastInsertRowid);
    const serialNumber = requested || autoFolio("SER-", id, 7);
    if (!requested) db.prepare("UPDATE inventory_serials SET serial_number = ? WHERE id = ?").run(serialNumber, id);
    return { id, serialNumber };
  } catch (error) { constraint(error, "Ese número de serie ya existe."); }
}

export function updateSerial(db, id, body) {
  const existing = db.prepare("SELECT * FROM inventory_serials WHERE id = ?").get(id);
  if (!existing) throw new InventoryError(404, "Serie no encontrada.");
  const itemId = existing.item_id;
  const lotId = optionalId(body.lotId, "lote");
  const warehouseId = optionalId(body.warehouseId, "almacén");
  const locationId = optionalId(body.locationId, "ubicación");
  if (warehouseId) validateStockKey(db, itemId, warehouseId, locationId, lotId);
  else if (locationId) throw new InventoryError(400, "Selecciona el almacén de la ubicación.");
  const serialNumber = text(body.serialNumber ?? existing.serial_number, 120).toUpperCase();
  const status = enumValue(body.status, ["available", "reserved", "issued", "blocked"], existing.status);
  try {
    db.prepare(`UPDATE inventory_serials SET serial_number = ?, lot_id = ?, status = ?, current_warehouse_id = ?, current_location_id = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(serialNumber, lotId, status, warehouseId, locationId, text(body.notes, 500), id);
    return { id, serialNumber };
  } catch (error) { constraint(error, "Ese número de serie ya existe."); }
}

export function listCounts(db) {
  return db.prepare(`SELECT c.*, w.code AS warehouse_code, w.name AS warehouse_name,
    usr.full_name AS created_by_name,
    (SELECT COUNT(*) FROM inventory_count_lines cl WHERE cl.count_id = c.id) AS line_count,
    (SELECT COUNT(*) FROM inventory_count_lines cl WHERE cl.count_id = c.id AND cl.counted_quantity IS NOT NULL) AS counted_lines
    FROM inventory_counts c JOIN warehouses w ON w.id = c.warehouse_id
    LEFT JOIN users usr ON usr.id = c.created_by
    ORDER BY c.id DESC`).all();
}

export function createCount(db, body, userId) {
  const warehouseId = positiveId(body.warehouseId, "almacén");
  validateWarehouse(db, warehouseId);
  const notes = text(body.notes, 500);
  const scheduledAt = optionalDate(body.scheduledAt, "La fecha programada");
  return transaction(db, () => {
    if (db.prepare("SELECT id FROM inventory_counts WHERE warehouse_id = ? AND status IN ('draft', 'in_progress')").get(warehouseId))
      throw new InventoryError(409, "Ya existe un conteo abierto para ese almacén.");
    const result = db.prepare(`INSERT INTO inventory_counts (folio, warehouse_id, notes, scheduled_at, created_by)
      VALUES (?, ?, ?, ?, ?)`).run(placeholder("CNT"), warehouseId, notes, scheduledAt, userId);
    const id = Number(result.lastInsertRowid);
    const folio = autoFolio("CNT-", id);
    db.prepare("UPDATE inventory_counts SET folio = ? WHERE id = ?").run(folio, id);
    db.prepare(`INSERT INTO inventory_count_lines (count_id, item_id, location_id, lot_id, system_quantity, unit_cost)
      SELECT ?, item_id, location_id, lot_id, quantity, average_cost FROM inventory_balances WHERE warehouse_id = ?`).run(id, warehouseId);
    db.prepare(`INSERT INTO inventory_count_lines (count_id, item_id, system_quantity, unit_cost)
      SELECT ?, i.id, 0, i.standard_cost FROM items i
      WHERE i.is_active = 1 AND i.inventory_tracked = 1
      AND NOT EXISTS (SELECT 1 FROM inventory_balances b WHERE b.warehouse_id = ? AND b.item_id = i.id)`).run(id, warehouseId);
    return { id, folio };
  });
}

export function getCount(db, id) {
  const count = db.prepare(`SELECT c.*, w.code AS warehouse_code, w.name AS warehouse_name
    FROM inventory_counts c JOIN warehouses w ON w.id = c.warehouse_id WHERE c.id = ?`).get(id);
  if (!count) throw new InventoryError(404, "Conteo no encontrado.");
  const lines = db.prepare(`SELECT cl.*, i.sku, i.name AS item_name, u.symbol AS unit_symbol,
    l.code AS location_code, l.name AS location_name, lot.lot_number
    FROM inventory_count_lines cl JOIN items i ON i.id = cl.item_id
    LEFT JOIN units_of_measure u ON u.id = i.unit_id
    LEFT JOIN inventory_locations l ON l.id = cl.location_id
    LEFT JOIN inventory_lots lot ON lot.id = cl.lot_id
    WHERE cl.count_id = ? ORDER BY i.name, l.name, lot.lot_number`).all(id);
  return { count, lines };
}

export function updateCountLine(db, countId, lineId, body) {
  const count = db.prepare("SELECT status FROM inventory_counts WHERE id = ?").get(countId);
  if (!count) throw new InventoryError(404, "Conteo no encontrado.");
  if (count.status !== "in_progress") throw new InventoryError(409, "El conteo ya no admite capturas.");
  const quantity = nonNegativeNumber(body.countedQuantity, "La cantidad contada");
  const result = db.prepare(`UPDATE inventory_count_lines SET counted_quantity = ?, variance = ? - system_quantity,
    updated_at = CURRENT_TIMESTAMP WHERE id = ? AND count_id = ?`).run(quantity, quantity, lineId, countId);
  if (!result.changes) throw new InventoryError(404, "Partida de conteo no encontrada.");
  return { id: lineId, countedQuantity: quantity };
}

export function completeCount(db, id, userId) {
  return transaction(db, () => {
    const count = db.prepare("SELECT * FROM inventory_counts WHERE id = ?").get(id);
    if (!count) throw new InventoryError(404, "Conteo no encontrado.");
    if (count.status !== "in_progress") throw new InventoryError(409, "El conteo no está abierto.");
    const missing = db.prepare("SELECT COUNT(*) AS value FROM inventory_count_lines WHERE count_id = ? AND counted_quantity IS NULL").get(id).value;
    if (missing) throw new InventoryError(409, `Falta capturar ${missing} partida(s) del conteo.`);
    const lines = db.prepare("SELECT * FROM inventory_count_lines WHERE count_id = ? AND ABS(counted_quantity - system_quantity) > 0.0000001").all(id);
    for (const line of lines) {
      const delta = line.counted_quantity - line.system_quantity;
      const current = getBalance(db, line.item_id, count.warehouse_id, line.location_id, line.lot_id);
      if (delta < 0 && current && current.reserved_quantity > line.counted_quantity)
        throw new InventoryError(409, "Una cantidad contada es menor que lo reservado. Libera las reservas antes de cerrar el conteo.");
      changeBalance(db, { itemId: line.item_id, warehouseId: count.warehouse_id, locationId: line.location_id, lotId: line.lot_id, quantityDelta: delta, incomingCost: line.unit_cost });
      insertMovement(db, {
        type: "count", itemId: line.item_id, quantity: Math.abs(delta),
        fromWarehouseId: delta < 0 ? count.warehouse_id : null, fromLocationId: delta < 0 ? line.location_id : null,
        toWarehouseId: delta > 0 ? count.warehouse_id : null, toLocationId: delta > 0 ? line.location_id : null,
        lotId: line.lot_id, serialId: null, unitCost: line.unit_cost,
        reason: "Diferencia de conteo físico", reference: count.folio, occurredAt: null, userId,
      });
    }
    db.prepare("UPDATE inventory_counts SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    return { id, folio: count.folio, adjustments: lines.length };
  });
}

function insertMovement(db, data) {
  const result = db.prepare(`INSERT INTO inventory_movements
    (folio, movement_type, item_id, quantity, from_warehouse_id, from_location_id,
      to_warehouse_id, to_location_id, lot_id, serial_id, unit_cost, reason, reference, occurred_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)`)
    .run(placeholder(data.type), data.type, data.itemId, data.quantity, data.fromWarehouseId ?? null,
      data.fromLocationId ?? null, data.toWarehouseId ?? null, data.toLocationId ?? null,
      data.lotId ?? null, data.serialId ?? null, data.unitCost ?? 0, data.reason ?? "",
      data.reference ?? "", data.occurredAt ?? null, data.userId ?? null);
  const id = Number(result.lastInsertRowid);
  const folio = autoFolio(MOVEMENT_PREFIX[data.type], id);
  db.prepare("UPDATE inventory_movements SET folio = ? WHERE id = ?").run(folio, id);
  return { id, folio };
}

function changeBalance(db, { itemId, warehouseId, locationId = null, lotId = null, quantityDelta = 0, reservedDelta = 0, incomingCost = 0 }) {
  let row = getBalance(db, itemId, warehouseId, locationId, lotId);
  if (!row) {
    if (quantityDelta < 0 || reservedDelta < 0) throw new InventoryError(409, "No existe saldo para realizar el movimiento.");
    const result = db.prepare(`INSERT INTO inventory_balances
      (item_id, warehouse_id, location_id, lot_id, quantity, reserved_quantity, average_cost)
      VALUES (?, ?, ?, ?, 0, 0, 0)`).run(itemId, warehouseId, locationId, lotId);
    row = { id: Number(result.lastInsertRowid), quantity: 0, reserved_quantity: 0, average_cost: 0 };
  }
  const nextQuantity = roundQuantity(row.quantity + quantityDelta);
  const nextReserved = roundQuantity(row.reserved_quantity + reservedDelta);
  if (nextQuantity < 0 || nextReserved < 0 || nextReserved > nextQuantity)
    throw new InventoryError(409, "El movimiento produciría un saldo o una reserva inválidos.");
  let averageCost = Number(row.average_cost);
  if (quantityDelta > 0) {
    averageCost = nextQuantity > 0
      ? roundMoney(((Number(row.quantity) * averageCost) + (quantityDelta * Number(incomingCost || 0))) / nextQuantity)
      : Number(incomingCost || 0);
  }
  db.prepare(`UPDATE inventory_balances SET quantity = ?, reserved_quantity = ?, average_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(nextQuantity, nextReserved, averageCost, row.id);
  return { id: row.id, quantity: nextQuantity, reservedQuantity: nextReserved, averageCost };
}

function getBalance(db, itemId, warehouseId, locationId, lotId) {
  return db.prepare(`SELECT * FROM inventory_balances WHERE item_id = ? AND warehouse_id = ?
    AND IFNULL(location_id, 0) = IFNULL(?, 0) AND IFNULL(lot_id, 0) = IFNULL(?, 0)`).get(itemId, warehouseId, locationId, lotId);
}

function validateStockKey(db, itemId, warehouseId, locationId, lotId) {
  validateItem(db, itemId);
  validateWarehouse(db, warehouseId);
  if (locationId) {
    const location = db.prepare("SELECT warehouse_id, is_active FROM inventory_locations WHERE id = ?").get(locationId);
    if (!location || !location.is_active || location.warehouse_id !== warehouseId)
      throw new InventoryError(400, "La ubicación no pertenece al almacén seleccionado o está inactiva.");
  }
  if (lotId) {
    const lot = db.prepare("SELECT item_id, status FROM inventory_lots WHERE id = ?").get(lotId);
    if (!lot || lot.item_id !== itemId || lot.status === "blocked" || lot.status === "expired")
      throw new InventoryError(400, "El lote no pertenece al artículo o no está disponible.");
  }
}

function validateItem(db, id) {
  if (!db.prepare("SELECT id FROM items WHERE id = ? AND is_active = 1 AND inventory_tracked = 1").get(id))
    throw new InventoryError(400, "El artículo no existe, está inactivo o no controla inventario.");
}

function validateWarehouse(db, id) {
  if (!db.prepare("SELECT id FROM warehouses WHERE id = ? AND is_active = 1").get(id))
    throw new InventoryError(400, "El almacén no existe o está inactivo.");
}

function itemCost(db, id) {
  return Number(db.prepare("SELECT standard_cost FROM items WHERE id = ?").get(id)?.standard_cost ?? 0);
}

function activeReservation(db, id) {
  const row = db.prepare("SELECT * FROM inventory_reservations WHERE id = ?").get(id);
  if (!row) throw new InventoryError(404, "Reserva no encontrada.");
  if (row.status !== "active") throw new InventoryError(409, "La reserva ya fue procesada.");
  return row;
}

function cleanMovement(body, options) {
  let quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity === 0 || (!options.signedQuantity && quantity < 0))
    throw new InventoryError(400, options.signedQuantity ? "El ajuste debe ser diferente de cero." : "La cantidad debe ser mayor que cero.");
  quantity = roundQuantity(quantity);
  const unitCost = body.unitCost == null || body.unitCost === "" ? 0 : nonNegativeNumber(body.unitCost, "El costo unitario");
  return {
    itemId: positiveId(body.itemId, "artículo"), quantity,
    fromWarehouseId: options.needsFrom ? positiveId(body.fromWarehouseId, "almacén de origen") : null,
    fromLocationId: options.needsFrom ? optionalId(body.fromLocationId, "ubicación de origen") : null,
    toWarehouseId: options.needsTo ? positiveId(body.toWarehouseId, "almacén de destino") : null,
    toLocationId: options.needsTo ? optionalId(body.toLocationId, "ubicación de destino") : null,
    lotId: optionalId(body.lotId, "lote"), serialId: optionalId(body.serialId, "serie"),
    unitCost, reason: text(body.reason, 300), reference: text(body.reference, 120),
    occurredAt: optionalDateTime(body.occurredAt),
  };
}

function cleanLocation(body) {
  const name = text(body.name, 120);
  if (!name) throw new InventoryError(400, "El nombre de la ubicación es obligatorio.");
  return {
    warehouseId: positiveId(body.warehouseId, "almacén"), name,
    zone: text(body.zone, 50), aisle: text(body.aisle, 50), rack: text(body.rack, 50),
    level: text(body.level, 50), bin: text(body.bin, 50), isActive: body.isActive === false ? 0 : 1,
  };
}

function transaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function positiveId(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new InventoryError(400, `Selecciona un ${label} válido.`);
  return number;
}

function optionalId(value, label) {
  if (value == null || value === "") return null;
  return positiveId(value, label);
}

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new InventoryError(400, `${label} debe ser mayor que cero.`);
  return roundQuantity(number);
}

function nonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new InventoryError(400, `${label} no es válido.`);
  return roundQuantity(number);
}

function optionalDate(value, label) {
  if (value == null || value === "") return null;
  const date = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new InventoryError(400, `${label} no es válida.`);
  return date;
}

function optionalDateTime(value) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new InventoryError(400, "La fecha del movimiento no es válida.");
  return date.toISOString().replace("T", " ").replace("Z", "");
}

function enumValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function text(value, max) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function placeholder(kind) {
  return `AUTO-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function autoFolio(prefix, id, padding = 6) {
  return `${prefix}${String(id).padStart(padding, "0")}`;
}

function roundQuantity(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6;
}

function nullableEqual(left, right) {
  return (left ?? null) === (right ?? null);
}

function constraint(error, message) {
  const value = String(error?.message ?? "");
  if (value.includes("UNIQUE constraint failed")) throw new InventoryError(409, message);
  if (value.includes("FOREIGN KEY constraint failed")) throw new InventoryError(400, "La relación seleccionada no es válida.");
  throw error;
}
