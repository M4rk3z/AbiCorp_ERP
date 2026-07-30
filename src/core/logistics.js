import * as sales from "./sales.js";

export class LogisticsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function options(db) {
  return {
    orders: db.prepare(`SELECT o.id, o.folio, o.status, o.expected_date, o.currency_id, o.exchange_rate,
      COALESCE(c.trade_name, c.legal_name) AS customer_name, c.address,
      COALESCE((SELECT SUM(l.quantity) FROM sales_document_lines l WHERE l.document_id = o.id), 0) AS ordered_quantity,
      COALESCE((SELECT SUM(dl.quantity) FROM sales_document_lines dl JOIN sales_documents d ON d.id = dl.document_id
        WHERE d.source_document_id = o.id AND d.document_type = 'delivery' AND d.status = 'posted'), 0) AS delivered_quantity
      FROM sales_documents o JOIN customers c ON c.id = o.customer_id
      WHERE o.document_type = 'order' AND o.status IN ('confirmed', 'partially_fulfilled')
        AND NOT EXISTS (SELECT 1 FROM logistics_shipments s WHERE s.order_id = o.id
          AND s.status NOT IN ('delivered', 'cancelled'))
      ORDER BY o.expected_date, o.id DESC`).all(),
    warehouses: db.prepare("SELECT id, code, name FROM warehouses WHERE is_active = 1 ORDER BY name").all(),
    locations: db.prepare(`SELECT l.id, l.code, l.name, l.warehouse_id FROM inventory_locations l
      JOIN warehouses w ON w.id = l.warehouse_id WHERE l.is_active = 1 AND w.is_active = 1 ORDER BY l.name`).all(),
    lots: db.prepare(`SELECT lot.id, lot.item_id, lot.lot_number FROM inventory_lots lot
      WHERE lot.status = 'active' ORDER BY lot.expiration_date, lot.lot_number`).all(),
    carriers: db.prepare("SELECT id, code, name, service_type FROM logistics_carriers WHERE is_active = 1 ORDER BY name").all(),
    routes: db.prepare(`SELECT r.id, r.folio, r.name, r.route_date, r.carrier_id, c.name AS carrier_name
      FROM logistics_routes r LEFT JOIN logistics_carriers c ON c.id = r.carrier_id
      WHERE r.status = 'planned' ORDER BY r.route_date, r.id DESC`).all(),
  };
}

export function control(db) {
  const shipments = db.prepare(`SELECT s.*, o.folio AS order_folio, o.status AS order_status,
    COALESCE(cu.trade_name, cu.legal_name) AS customer_name, w.code AS warehouse_code, w.name AS warehouse_name,
    r.folio AS route_folio, r.name AS route_name, ca.name AS carrier_name, d.folio AS delivery_folio,
    COUNT(sl.id) AS line_count, COALESCE(SUM(sl.requested_quantity), 0) AS requested_quantity,
    COALESCE(SUM(sl.picked_quantity), 0) AS picked_quantity, COALESCE(SUM(sl.packed_quantity), 0) AS packed_quantity,
    (SELECT COUNT(*) FROM logistics_evidence e WHERE e.shipment_id = s.id) AS evidence_count
    FROM logistics_shipments s JOIN sales_documents o ON o.id = s.order_id JOIN customers cu ON cu.id = o.customer_id
    JOIN warehouses w ON w.id = s.warehouse_id LEFT JOIN logistics_routes r ON r.id = s.route_id
    LEFT JOIN logistics_carriers ca ON ca.id = s.carrier_id LEFT JOIN sales_documents d ON d.id = s.sales_delivery_id
    LEFT JOIN logistics_shipment_lines sl ON sl.shipment_id = s.id
    GROUP BY s.id ORDER BY s.id DESC`).all();
  const carriers = db.prepare(`SELECT c.*, COUNT(DISTINCT r.id) AS route_count, COUNT(DISTINCT s.id) AS shipment_count
    FROM logistics_carriers c LEFT JOIN logistics_routes r ON r.carrier_id = c.id
    LEFT JOIN logistics_shipments s ON s.carrier_id = c.id GROUP BY c.id ORDER BY c.is_active DESC, c.name`).all();
  const routes = db.prepare(`SELECT r.*, c.code AS carrier_code, c.name AS carrier_name,
    COUNT(s.id) AS shipment_count,
    SUM(CASE WHEN s.status = 'delivered' THEN 1 ELSE 0 END) AS delivered_count
    FROM logistics_routes r LEFT JOIN logistics_carriers c ON c.id = r.carrier_id
    LEFT JOIN logistics_shipments s ON s.route_id = r.id GROUP BY r.id ORDER BY r.route_date DESC, r.id DESC`).all();
  const evidence = db.prepare(`SELECT e.*, s.folio AS shipment_folio, o.folio AS order_folio,
    COALESCE(c.trade_name, c.legal_name) AS customer_name, d.original_name, d.mime_type, d.size_bytes
    FROM logistics_evidence e JOIN logistics_shipments s ON s.id = e.shipment_id
    JOIN sales_documents o ON o.id = s.order_id JOIN customers c ON c.id = o.customer_id
    LEFT JOIN documents d ON d.id = e.document_id ORDER BY e.id DESC LIMIT 200`).all();
  return { shipments, carriers, routes, evidence };
}

export function shipmentDetail(db, id) {
  const shipment = db.prepare(`SELECT s.*, o.folio AS order_folio, o.status AS order_status,
    o.currency_id, o.exchange_rate, COALESCE(c.trade_name, c.legal_name) AS customer_name,
    c.code AS customer_code, w.code AS warehouse_code, w.name AS warehouse_name,
    r.folio AS route_folio, r.name AS route_name, ca.name AS carrier_name, d.folio AS delivery_folio
    FROM logistics_shipments s JOIN sales_documents o ON o.id = s.order_id JOIN customers c ON c.id = o.customer_id
    JOIN warehouses w ON w.id = s.warehouse_id LEFT JOIN logistics_routes r ON r.id = s.route_id
    LEFT JOIN logistics_carriers ca ON ca.id = s.carrier_id LEFT JOIN sales_documents d ON d.id = s.sales_delivery_id
    WHERE s.id = ?`).get(id);
  if (!shipment) throw new LogisticsError(404, "Embarque no encontrado.");
  const lines = db.prepare(`SELECT l.*, i.sku, i.name AS item_name, i.inventory_tracked, u.symbol AS unit_symbol,
    loc.code AS location_code, loc.name AS location_name, lot.lot_number,
    COALESCE((SELECT SUM(b.quantity - b.reserved_quantity) FROM inventory_balances b
      WHERE b.item_id = l.item_id AND b.warehouse_id = s.warehouse_id), 0) AS warehouse_available
    FROM logistics_shipment_lines l JOIN logistics_shipments s ON s.id = l.shipment_id
    JOIN items i ON i.id = l.item_id LEFT JOIN units_of_measure u ON u.id = i.unit_id
    LEFT JOIN inventory_locations loc ON loc.id = l.location_id LEFT JOIN inventory_lots lot ON lot.id = l.lot_id
    WHERE l.shipment_id = ? ORDER BY l.id`).all(id);
  const evidence = db.prepare(`SELECT e.*, d.original_name, d.mime_type, d.size_bytes
    FROM logistics_evidence e LEFT JOIN documents d ON d.id = e.document_id
    WHERE e.shipment_id = ? ORDER BY e.id DESC`).all(id);
  return { shipment, lines, evidence };
}

export function createCarrier(db, body, userId) {
  const name = requiredText(body.name, 160, "El nombre del transportista");
  const result = db.prepare(`INSERT INTO logistics_carriers
    (code, name, contact_name, phone, email, service_type, vehicle_type, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(placeholder("TRA"), name, text(body.contactName, 160), text(body.phone, 50), text(body.email, 180),
      enumValue(body.serviceType, ["local", "national", "international", "own_fleet"], "local"),
      text(body.vehicleType, 100), text(body.notes, 1000), userId);
  const id = Number(result.lastInsertRowid);
  const code = autoFolio("TRP-", id, 5);
  db.prepare("UPDATE logistics_carriers SET code = ? WHERE id = ?").run(code, id);
  return { id, folio: code };
}

export function createRoute(db, body, userId) {
  const name = requiredText(body.name, 160, "El nombre de la ruta");
  const routeDate = date(body.routeDate, "La fecha de ruta");
  const carrierId = optionalId(body.carrierId, "transportista");
  if (carrierId && !db.prepare("SELECT id FROM logistics_carriers WHERE id = ? AND is_active = 1").get(carrierId))
    throw new LogisticsError(400, "El transportista no está disponible.");
  const result = db.prepare(`INSERT INTO logistics_routes
    (folio, name, carrier_id, route_date, driver_name, vehicle_plate, origin, destination, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(placeholder("RLE"), name, carrierId, routeDate, text(body.driverName, 160), text(body.vehiclePlate, 40),
      text(body.origin, 240), text(body.destination, 240), text(body.notes, 1000), userId);
  const id = Number(result.lastInsertRowid);
  const folio = autoFolio("RLE-", id);
  db.prepare("UPDATE logistics_routes SET folio = ? WHERE id = ?").run(folio, id);
  return { id, folio };
}

export function createShipment(db, body, userId) {
  const orderId = positiveId(body.orderId, "pedido");
  const warehouseId = positiveId(body.warehouseId, "almacén");
  const order = db.prepare(`SELECT o.*, c.address FROM sales_documents o JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ? AND o.document_type = 'order'`).get(orderId);
  if (!order || !["confirmed", "partially_fulfilled"].includes(order.status))
    throw new LogisticsError(409, "El pedido debe estar confirmado y tener cantidades pendientes.");
  if (!db.prepare("SELECT id FROM warehouses WHERE id = ? AND is_active = 1").get(warehouseId))
    throw new LogisticsError(400, "El almacén no está disponible.");
  if (db.prepare("SELECT id FROM logistics_shipments WHERE order_id = ? AND status NOT IN ('delivered','cancelled')").get(orderId))
    throw new LogisticsError(409, "El pedido ya tiene una preparación activa.");
  const orderLines = sales.getDocument(db, orderId).lines;
  const pending = orderLines.map((line) => ({ ...line, pending: round(Number(line.quantity) - Number(line.delivered_quantity)) }))
    .filter((line) => line.pending > 0);
  if (!pending.length) throw new LogisticsError(409, "El pedido ya no tiene cantidades pendientes.");
  return transaction(db, () => {
    const result = db.prepare(`INSERT INTO logistics_shipments
      (folio, order_id, warehouse_id, scheduled_date, shipping_address, prepared_by)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(placeholder("EMB"), orderId, warehouseId, optionalDate(body.scheduledDate, "La fecha programada"),
        text(body.shippingAddress, 800) || order.address || "", userId);
    const id = Number(result.lastInsertRowid);
    const folio = autoFolio("EMB-", id);
    db.prepare("UPDATE logistics_shipments SET folio = ? WHERE id = ?").run(folio, id);
    const insert = db.prepare(`INSERT INTO logistics_shipment_lines
      (shipment_id, order_line_id, item_id, requested_quantity) VALUES (?, ?, ?, ?)`);
    for (const line of pending) insert.run(id, line.id, line.item_id, line.pending);
    return { id, folio };
  });
}

export function addEvidence(db, body, userId) {
  const shipmentId = positiveId(body.shipmentId, "embarque");
  if (!db.prepare("SELECT id FROM logistics_shipments WHERE id = ?").get(shipmentId)) throw new LogisticsError(404, "Embarque no encontrado.");
  const documentId = optionalId(body.documentId, "documento");
  const description = text(body.description, 1000);
  if (documentId && !db.prepare("SELECT id FROM documents WHERE id = ? AND module = 'logistics'").get(documentId))
    throw new LogisticsError(400, "El archivo de evidencia no es válido.");
  if (!documentId && !description) throw new LogisticsError(400, "Agrega un archivo o una nota como evidencia.");
  const result = db.prepare(`INSERT INTO logistics_evidence
    (shipment_id, evidence_type, document_id, description, captured_at, created_by)
    VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)`)
    .run(shipmentId, enumValue(body.evidenceType, ["photo", "signature", "document", "note"], documentId ? "photo" : "note"),
      documentId, description, optionalDateTime(body.capturedAt, "La fecha de captura"), userId);
  return { id: Number(result.lastInsertRowid), folio: `EVI-${String(result.lastInsertRowid).padStart(6, "0")}` };
}

export function shipmentAction(db, id, body, userId) {
  const action = String(body.action || "");
  const detail = shipmentDetail(db, id);
  const shipment = detail.shipment;
  if (action === "start_picking") {
    requireStatus(shipment, ["preparing"], "iniciar el picking");
    db.prepare("UPDATE logistics_shipments SET status = 'picking', picked_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(userId, id);
  } else if (action === "pick") {
    requireStatus(shipment, ["picking"], "registrar el picking");
    recordPick(db, shipment, detail.lines, body);
  } else if (action === "complete_picking") {
    requireStatus(shipment, ["picking"], "terminar el picking");
    const pending = db.prepare("SELECT COUNT(*) AS value FROM logistics_shipment_lines WHERE shipment_id = ? AND picked_quantity + 0.000001 < requested_quantity").get(id).value;
    if (pending) throw new LogisticsError(409, "Completa la cantidad solicitada de todas las partidas.");
    db.prepare("UPDATE logistics_shipments SET status = 'picked', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  } else if (action === "pack") {
    requireStatus(shipment, ["picked"], "registrar el packing");
    const packages = nonNegativeInteger(body.packageCount, "El número de bultos");
    if (packages < 1) throw new LogisticsError(400, "Indica al menos un bulto.");
    db.prepare("UPDATE logistics_shipment_lines SET packed_quantity = picked_quantity WHERE shipment_id = ?").run(id);
    db.prepare(`UPDATE logistics_shipments SET status = 'packed', package_count = ?, total_weight = ?,
      tracking_number = ?, delivery_notes = ?, packed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(packages, nonNegative(body.totalWeight, "El peso total"), text(body.trackingNumber, 120), text(body.notes, 1000), userId, id);
  } else if (action === "assign_route") {
    requireStatus(shipment, ["packed"], "asignar la ruta");
    const routeId = positiveId(body.routeId, "ruta");
    const route = db.prepare("SELECT * FROM logistics_routes WHERE id = ? AND status = 'planned'").get(routeId);
    if (!route) throw new LogisticsError(400, "La ruta no está disponible.");
    db.prepare("UPDATE logistics_shipments SET route_id = ?, carrier_id = COALESCE(?, carrier_id), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(routeId, route.carrier_id, id);
  } else if (action === "dispatch") {
    requireStatus(shipment, ["packed"], "despachar");
    if (!shipment.route_id && !shipment.carrier_id) throw new LogisticsError(409, "Asigna una ruta o transportista antes de despachar.");
    db.prepare("UPDATE logistics_shipments SET status = 'in_transit', dispatched_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    if (shipment.route_id) db.prepare("UPDATE logistics_routes SET status = 'in_transit', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'planned'").run(shipment.route_id);
  } else if (action === "confirm") {
    return confirmDelivery(db, shipmentDetail(db, id), body, userId);
  } else if (action === "cancel") {
    requireStatus(shipment, ["preparing", "picking"], "cancelar");
    db.prepare("UPDATE logistics_shipments SET status = 'cancelled', delivery_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(text(body.notes, 1000), id);
  } else {
    throw new LogisticsError(400, "Acción logística no reconocida.");
  }
  return { id, folio: shipment.folio, status: db.prepare("SELECT status FROM logistics_shipments WHERE id = ?").get(id).status };
}

function recordPick(db, shipment, lines, body) {
  const lineId = positiveId(body.lineId, "partida");
  const line = lines.find((row) => row.id === lineId);
  if (!line) throw new LogisticsError(404, "Partida de embarque no encontrada.");
  const quantity = positive(body.quantity, "La cantidad surtida");
  if (quantity > Number(line.requested_quantity) + 0.000001) throw new LogisticsError(409, "La cantidad surtida supera la solicitada.");
  const locationId = optionalId(body.locationId, "ubicación");
  const lotId = optionalId(body.lotId, "lote");
  if (line.inventory_tracked && !locationId) throw new LogisticsError(400, "Selecciona la ubicación de la existencia.");
  if (locationId && !db.prepare("SELECT id FROM inventory_locations WHERE id = ? AND warehouse_id = ? AND is_active = 1").get(locationId, shipment.warehouse_id))
    throw new LogisticsError(400, "La ubicación no pertenece al almacén del embarque.");
  if (lotId && !db.prepare("SELECT id FROM inventory_lots WHERE id = ? AND item_id = ? AND status = 'active'").get(lotId, line.item_id))
    throw new LogisticsError(400, "El lote no corresponde al artículo.");
  if (line.inventory_tracked) {
    const available = db.prepare(`SELECT COALESCE(SUM(quantity - reserved_quantity), 0) AS value FROM inventory_balances
      WHERE item_id = ? AND warehouse_id = ? AND IFNULL(location_id, 0) = IFNULL(?, 0)
        AND IFNULL(lot_id, 0) = IFNULL(?, 0)`).get(line.item_id, shipment.warehouse_id, locationId, lotId).value;
    if (Number(available) + 0.000001 < quantity) throw new LogisticsError(409, `Solo hay ${round(available)} unidad(es) disponibles en la ubicación seleccionada.`);
  }
  db.prepare(`UPDATE logistics_shipment_lines SET picked_quantity = ?, location_id = ?, lot_id = ?, notes = ? WHERE id = ?`)
    .run(quantity, locationId, lotId, text(body.notes, 500), lineId);
}

function confirmDelivery(db, detail, body, userId) {
  const shipment = detail.shipment;
  requireStatus(shipment, ["in_transit"], "confirmar la entrega");
  const receiverName = requiredText(body.receiverName, 160, "El nombre de quien recibe");
  if (!detail.lines.length || detail.lines.some((line) => Number(line.packed_quantity) <= 0))
    throw new LogisticsError(409, "El embarque no tiene partidas empacadas válidas.");
  const delivery = sales.createDocument(db, "delivery", {
    sourceDocumentId: shipment.order_id,
    customerId: null,
    prospectId: null,
    currencyId: shipment.currency_id,
    exchangeRate: shipment.exchange_rate,
    issueDate: today(),
    paymentTermsDays: 0,
    notes: `Entrega confirmada desde ${shipment.folio}. Recibió: ${receiverName}. ${text(body.notes, 700)}`,
    lines: detail.lines.map((line) => ({
      sourceLineId: line.order_line_id,
      quantity: line.packed_quantity,
      warehouseId: shipment.warehouse_id,
      locationId: line.location_id,
      lotId: line.lot_id,
    })),
  }, userId);
  db.prepare(`UPDATE logistics_shipments SET status = 'delivered', receiver_name = ?, delivery_notes = ?,
    sales_delivery_id = ?, confirmed_by = ?, delivered_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(receiverName, text(body.notes, 1000), delivery.id, userId, shipment.id);
  if (shipment.route_id) {
    const active = db.prepare("SELECT COUNT(*) AS value FROM logistics_shipments WHERE route_id = ? AND status NOT IN ('delivered','cancelled')").get(shipment.route_id).value;
    if (!active) db.prepare("UPDATE logistics_routes SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(shipment.route_id);
  }
  return { id: shipment.id, folio: shipment.folio, status: "delivered", deliveryId: delivery.id, deliveryFolio: delivery.folio };
}

function requireStatus(shipment, allowed, action) {
  if (!allowed.includes(shipment.status)) throw new LogisticsError(409, `El embarque no permite ${action} en su estado actual.`);
}
function transaction(db, work) { db.exec("BEGIN IMMEDIATE"); try { const value = work(); db.exec("COMMIT"); return value; } catch (error) { db.exec("ROLLBACK"); throw error; } }
function positiveId(value, label) { const number = Number(value); if (!Number.isInteger(number) || number < 1) throw new LogisticsError(400, `Selecciona un ${label} válido.`); return number; }
function optionalId(value, label) { return value == null || value === "" ? null : positiveId(value, label); }
function positive(value, label) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new LogisticsError(400, `${label} debe ser mayor que cero.`); return round(number); }
function nonNegative(value, label) { const number = Number(value ?? 0); if (!Number.isFinite(number) || number < 0) throw new LogisticsError(400, `${label} no es válido.`); return round(number); }
function nonNegativeInteger(value, label) { const number = Number(value ?? 0); if (!Number.isInteger(number) || number < 0) throw new LogisticsError(400, `${label} no es válido.`); return number; }
function requiredText(value, max, label) { const result = text(value, max); if (!result) throw new LogisticsError(400, `${label} es obligatorio.`); return result; }
function text(value, max) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""; }
function enumValue(value, values, fallback) { return values.includes(value) ? value : fallback; }
function date(value, label) { const result = String(value || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new LogisticsError(400, `${label} no es válida.`); return result; }
function optionalDate(value, label) { return value == null || value === "" ? null : date(value, label); }
function optionalDateTime(value, label) { if (value == null || value === "") return null; const parsed = new Date(value); if (Number.isNaN(parsed.getTime())) throw new LogisticsError(400, `${label} no es válida.`); return String(value).replace("T", " "); }
function placeholder(kind) { return `AUTO-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function autoFolio(prefix, id, padding = 6) { return `${prefix}${String(id).padStart(padding, "0")}`; }
function today() { return new Date().toISOString().slice(0, 10); }
function round(value) { return Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6; }
