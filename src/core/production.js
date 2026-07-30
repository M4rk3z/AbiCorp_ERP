import * as inventory from "./inventory.js";

export class ProductionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function options(db) {
  return {
    products: db.prepare(`SELECT i.id, i.sku, i.name, i.standard_cost, u.symbol AS unit_symbol
      FROM items i LEFT JOIN units_of_measure u ON u.id = i.unit_id
      WHERE i.is_active = 1 AND i.production_enabled = 1 ORDER BY i.name`).all(),
    items: db.prepare(`SELECT i.id, i.sku, i.name, i.item_type, i.standard_cost, i.inventory_tracked, u.symbol AS unit_symbol
      FROM items i LEFT JOIN units_of_measure u ON u.id = i.unit_id
      WHERE i.is_active = 1 ORDER BY i.name`).all(),
    resources: db.prepare(`SELECT id, code, name, resource_type, capacity_per_hour, status
      FROM resources WHERE status <> 'inactive' ORDER BY name`).all(),
    warehouses: db.prepare(`SELECT w.id, w.code, w.name, b.name AS branch_name
      FROM warehouses w JOIN branches b ON b.id = w.branch_id WHERE w.is_active = 1 ORDER BY w.name`).all(),
    locations: db.prepare(`SELECT id, warehouse_id, code, name FROM inventory_locations WHERE is_active = 1 ORDER BY name`).all(),
    lots: db.prepare(`SELECT id, item_id, lot_number FROM inventory_lots WHERE status IN ('active', 'quarantine') ORDER BY id DESC`).all(),
    boms: db.prepare(`SELECT b.id, b.folio, b.product_id, b.version, b.output_quantity, b.status, b.is_phantom,
      i.sku, i.name AS product_name, COUNT(bl.id) AS line_count
      FROM production_boms b JOIN items i ON i.id = b.product_id
      LEFT JOIN production_bom_lines bl ON bl.bom_id = b.id GROUP BY b.id ORDER BY b.id DESC`).all(),
    routes: db.prepare(`SELECT r.id, r.folio, r.product_id, r.version, r.status, i.sku, i.name AS product_name,
      COUNT(op.id) AS operation_count, COALESCE(SUM(op.setup_minutes + op.run_minutes), 0) AS standard_minutes
      FROM production_routes r JOIN items i ON i.id = r.product_id
      LEFT JOIN production_route_operations op ON op.route_id = r.id GROUP BY r.id ORDER BY r.id DESC`).all(),
    demands: listDemands(db),
    orders: db.prepare(`SELECT id, folio, item_id, planned_quantity, status FROM production_orders
      WHERE status NOT IN ('closed', 'cancelled') ORDER BY id DESC`).all(),
  };
}

export function control(db) {
  const orders = listOrders(db);
  const demands = listDemands(db);
  const boms = db.prepare(`SELECT b.*, i.sku, i.name AS product_name, COUNT(bl.id) AS line_count,
    SUM(CASE WHEN bl.substitute_item_id IS NOT NULL THEN 1 ELSE 0 END) AS substitute_count
    FROM production_boms b JOIN items i ON i.id = b.product_id
    LEFT JOIN production_bom_lines bl ON bl.bom_id = b.id GROUP BY b.id ORDER BY b.id DESC`).all();
  const routes = db.prepare(`SELECT r.*, i.sku, i.name AS product_name, COUNT(op.id) AS operation_count,
    COALESCE(SUM(op.setup_minutes + op.run_minutes), 0) AS standard_minutes
    FROM production_routes r JOIN items i ON i.id = r.product_id
    LEFT JOIN production_route_operations op ON op.route_id = r.id GROUP BY r.id ORDER BY r.id DESC`).all();
  const events = db.prepare(`SELECT e.*, o.folio AS order_folio, i.sku, i.name AS item_name,
    op.name AS operation_name, u.full_name AS created_by_name
    FROM production_events e JOIN production_orders o ON o.id = e.order_id
    JOIN items i ON i.id = o.item_id LEFT JOIN production_order_operations op ON op.id = e.operation_id
    LEFT JOIN users u ON u.id = e.created_by ORDER BY e.id DESC LIMIT 20`).all();
  return { orders, demands, boms, routes, events };
}

export function createBom(db, body, userId) {
  const productId = positiveId(body.productId, "producto");
  validateProduct(db, productId);
  const version = requiredText(body.version, 30, "La versión");
  const outputQuantity = positiveNumber(body.outputQuantity ?? 1, "La cantidad de salida");
  const status = enumValue(body.status, ["draft", "active"], "draft");
  const lines = Array.isArray(body.lines) ? body.lines.map(cleanBomLine) : [];
  if (!lines.length) throw new ProductionError(400, "Agrega al menos un material a la lista.");
  if (new Set(lines.map((line) => line.componentItemId)).size !== lines.length)
    throw new ProductionError(400, "No repitas materiales en la misma lista.");
  if (lines.some((line) => line.componentItemId === productId))
    throw new ProductionError(400, "El producto no puede ser componente de sí mismo.");
  return transaction(db, () => {
    try {
      const result = db.prepare(`INSERT INTO production_boms
        (folio, product_id, version, output_quantity, status, is_phantom, effective_from, effective_to, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(placeholder("BOM"), productId, version, outputQuantity, status, body.isPhantom ? 1 : 0,
          optionalDate(body.effectiveFrom), optionalDate(body.effectiveTo), text(body.notes, 500), userId);
      const id = Number(result.lastInsertRowid);
      const folio = autoFolio("BOM-", id);
      db.prepare("UPDATE production_boms SET folio = ? WHERE id = ?").run(folio, id);
      const insert = db.prepare(`INSERT INTO production_bom_lines
        (bom_id, component_item_id, substitute_item_id, quantity, scrap_rate, notes) VALUES (?, ?, ?, ?, ?, ?)`);
      for (const line of lines) insert.run(id, line.componentItemId, line.substituteItemId, line.quantity, line.scrapRate, line.notes);
      if (status === "active") db.prepare("UPDATE production_boms SET status = 'obsolete' WHERE product_id = ? AND id <> ? AND status = 'active'").run(productId, id);
      return { id, folio };
    } catch (error) { constraint(error, "Ya existe esa versión de la lista de materiales."); }
  });
}

export function createRoute(db, body, userId) {
  const productId = positiveId(body.productId, "producto");
  validateProduct(db, productId);
  const version = requiredText(body.version, 30, "La versión");
  const status = enumValue(body.status, ["draft", "active"], "draft");
  const operations = Array.isArray(body.operations) ? body.operations.map((row, index) => cleanOperation(row, index)) : [];
  if (!operations.length) throw new ProductionError(400, "Agrega al menos una operación a la ruta.");
  return transaction(db, () => {
    try {
      const result = db.prepare(`INSERT INTO production_routes (folio, product_id, version, status, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?)`).run(placeholder("RUT"), productId, version, status, text(body.notes, 500), userId);
      const id = Number(result.lastInsertRowid);
      const folio = autoFolio("RUT-", id);
      db.prepare("UPDATE production_routes SET folio = ? WHERE id = ?").run(folio, id);
      const insert = db.prepare(`INSERT INTO production_route_operations
        (route_id, sequence, name, resource_id, setup_minutes, run_minutes, instructions) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const op of operations) insert.run(id, op.sequence, op.name, op.resourceId, op.setupMinutes, op.runMinutes, op.instructions);
      if (status === "active") db.prepare("UPDATE production_routes SET status = 'obsolete' WHERE product_id = ? AND id <> ? AND status = 'active'").run(productId, id);
      return { id, folio };
    } catch (error) { constraint(error, "Ya existe esa versión de la ruta o una secuencia está repetida."); }
  });
}

export function createDemand(db, body, userId) {
  const itemId = positiveId(body.itemId, "producto");
  validateProduct(db, itemId);
  const quantity = positiveNumber(body.quantity, "La cantidad requerida");
  const requiredDate = requiredDateValue(body.requiredDate, "La fecha requerida");
  const result = db.prepare(`INSERT INTO production_demands
    (folio, item_id, quantity, required_date, source, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(placeholder("DEM"), itemId, quantity, requiredDate, text(body.source, 80) || "forecast", text(body.notes, 500), userId);
  const id = Number(result.lastInsertRowid);
  const folio = autoFolio("DEM-", id);
  db.prepare("UPDATE production_demands SET folio = ? WHERE id = ?").run(folio, id);
  return { id, folio };
}

export function createOrder(db, body, userId) {
  const itemId = positiveId(body.itemId, "producto");
  const warehouseId = positiveId(body.warehouseId, "almacén");
  const plannedQuantity = positiveNumber(body.plannedQuantity, "La cantidad planeada");
  validateProduct(db, itemId);
  if (!db.prepare("SELECT id FROM warehouses WHERE id = ? AND is_active = 1").get(warehouseId)) throw new ProductionError(400, "El almacén no está disponible.");
  const bom = body.bomId ? db.prepare("SELECT * FROM production_boms WHERE id = ? AND product_id = ?").get(positiveId(body.bomId, "lista de materiales"), itemId)
    : db.prepare("SELECT * FROM production_boms WHERE product_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(itemId);
  const route = body.routeId ? db.prepare("SELECT * FROM production_routes WHERE id = ? AND product_id = ?").get(positiveId(body.routeId, "ruta"), itemId)
    : db.prepare("SELECT * FROM production_routes WHERE product_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(itemId);
  if (!bom) throw new ProductionError(409, "El producto necesita una lista de materiales activa.");
  if (!route) throw new ProductionError(409, "El producto necesita una ruta activa.");
  return transaction(db, () => {
    const result = db.prepare(`INSERT INTO production_orders
      (folio, parent_order_id, demand_id, item_id, bom_id, route_id, warehouse_id, planned_quantity,
       scheduled_start, scheduled_end, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(placeholder("OP"), optionalId(body.parentOrderId), optionalId(body.demandId), itemId, bom.id, route.id,
        warehouseId, plannedQuantity, optionalDateTime(body.scheduledStart), optionalDateTime(body.scheduledEnd), text(body.notes, 500), userId);
    const id = Number(result.lastInsertRowid);
    const folio = autoFolio("OP-", id);
    db.prepare("UPDATE production_orders SET folio = ? WHERE id = ?").run(folio, id);
    const factor = plannedQuantity / Number(bom.output_quantity);
    db.prepare(`INSERT INTO production_order_materials
      (order_id, bom_line_id, item_id, substitute_item_id, required_quantity, warehouse_id)
      SELECT ?, bl.id, bl.component_item_id, bl.substitute_item_id,
        ROUND(bl.quantity * (1 + bl.scrap_rate / 100.0) * ?, 6), ?
      FROM production_bom_lines bl WHERE bl.bom_id = ?`).run(id, factor, warehouseId, bom.id);
    db.prepare(`INSERT INTO production_order_operations
      (order_id, route_operation_id, sequence, name, resource_id, setup_minutes, standard_minutes, instructions)
      SELECT ?, op.id, op.sequence, op.name, op.resource_id, op.setup_minutes,
        ROUND(op.setup_minutes + op.run_minutes * ?, 6), op.instructions
      FROM production_route_operations op WHERE op.route_id = ?`).run(id, plannedQuantity, route.id);
    if (body.demandId) db.prepare("UPDATE production_demands SET status = 'planned', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(body.demandId);
    return { id, folio };
  });
}

export function createWorkOrdersFromSalesOrder(db, salesOrderId, userId) {
  const salesOrder = db.prepare(`SELECT d.*, COALESCE(c.trade_name, c.legal_name) AS customer_name
    FROM sales_documents d
    LEFT JOIN customers c ON c.id = d.customer_id
    WHERE d.id = ? AND d.document_type = 'order'`).get(salesOrderId);
  if (!salesOrder || salesOrder.status !== "confirmed") throw new ProductionError(409, "El pedido debe estar confirmado para generar órdenes de trabajo.");
  const lines = db.prepare(`SELECT l.id AS sales_line_id, l.item_id, l.quantity, l.description, l.warehouse_id,
      i.sku, i.name AS item_name, i.item_type, i.production_enabled
    FROM sales_document_lines l
    JOIN items i ON i.id = l.item_id
    WHERE l.document_id = ? AND i.item_type = 'finished'
    ORDER BY l.id`).all(salesOrderId);
  if (!lines.length) return { created: [], existing: [], ignored: true };

  const prepared = [];
  const problems = [];
  for (const line of lines) {
    if (!line.production_enabled) {
      problems.push(`${line.sku}: habilita el artículo para producción`);
      continue;
    }
    const existing = db.prepare("SELECT id, folio, status FROM production_orders WHERE sales_order_line_id = ?").get(line.sales_line_id);
    if (existing) { prepared.push({ line, existing }); continue; }
    const bom = db.prepare("SELECT * FROM production_boms WHERE product_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(line.item_id);
    const route = db.prepare("SELECT * FROM production_routes WHERE product_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(line.item_id);
    if (!bom) problems.push(`${line.sku}: falta una lista de materiales activa`);
    if (!route) problems.push(`${line.sku}: falta una ruta de trabajo activa`);
    if (!bom || !route) continue;
    const warehouse = selectProductionWarehouse(db, line.warehouse_id, bom.id);
    if (!warehouse) problems.push(`${line.sku}: no hay un almacén activo para surtir la producción`);
    else prepared.push({ line, bom, route, warehouse });
  }
  if (problems.length) throw new ProductionError(409, `No se puede aprobar el pedido. Configura producción para: ${problems.join("; ")}.`);

  const created = [];
  const existing = [];
  for (const entry of prepared) {
    if (entry.existing) { existing.push(entry.existing); continue; }
    const { line, bom, route, warehouse } = entry;
    const result = db.prepare(`INSERT INTO production_orders
      (folio, item_id, bom_id, route_id, warehouse_id, planned_quantity, scheduled_start, scheduled_end,
       notes, sales_order_id, sales_order_line_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(placeholder("OTP"), line.item_id, bom.id, route.id, warehouse.id, line.quantity,
        `${salesOrder.issue_date} 08:00:00`, salesOrder.expected_date ? `${salesOrder.expected_date} 17:00:00` : null,
        text(`Generada automáticamente desde ${salesOrder.folio}. ${salesOrder.customer_name || ""}. ${line.description || ""}`, 500),
        salesOrderId, line.sales_line_id, userId);
    const id = Number(result.lastInsertRowid);
    const folio = autoFolio("OT-P-", id);
    db.prepare("UPDATE production_orders SET folio = ? WHERE id = ?").run(folio, id);
    const factor = Number(line.quantity) / Number(bom.output_quantity);
    db.prepare(`INSERT INTO production_order_materials
      (order_id, bom_line_id, item_id, substitute_item_id, required_quantity, warehouse_id)
      SELECT ?, bl.id, bl.component_item_id, bl.substitute_item_id,
        ROUND(bl.quantity * (1 + bl.scrap_rate / 100.0) * ?, 6), ?
      FROM production_bom_lines bl WHERE bl.bom_id = ?`).run(id, factor, warehouse.id, bom.id);
    db.prepare(`INSERT INTO production_order_operations
      (order_id, route_operation_id, sequence, name, resource_id, setup_minutes, standard_minutes, instructions)
      SELECT ?, op.id, op.sequence, op.name, op.resource_id, op.setup_minutes,
        ROUND(op.setup_minutes + op.run_minutes * ?, 6), op.instructions
      FROM production_route_operations op WHERE op.route_id = ?`).run(id, Number(line.quantity), route.id);
    addEvent(db, id, null, "sales_order_created", line.quantity, 0, 0, `Generada al aprobar ${salesOrder.folio}`, null, userId);
    created.push({ id, folio, itemId: line.item_id, sku: line.sku, itemName: line.item_name, quantity: line.quantity, bomFolio: bom.folio, routeFolio: route.folio, warehouseId: warehouse.id, warehouseName: warehouse.name });
  }
  return { created, existing, ignored: false };
}

export function cancelWorkOrdersFromSalesOrder(db, salesOrderId, userId) {
  const orders = db.prepare("SELECT id, folio, status FROM production_orders WHERE sales_order_id = ? AND status <> 'cancelled'").all(salesOrderId);
  const protectedOrder = orders.find((order) => !["planned", "released"].includes(order.status));
  if (protectedOrder) throw new ProductionError(409, `No se puede cancelar el pedido porque la orden ${protectedOrder.folio} ya está en ejecución o terminada.`);
  for (const order of orders) {
    db.prepare("UPDATE production_orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
    addEvent(db, order.id, null, "sales_order_cancelled", 0, 0, 0, "Cancelada junto con el pedido de venta", null, userId);
  }
  return orders;
}

function selectProductionWarehouse(db, requestedWarehouseId, bomId) {
  if (requestedWarehouseId) {
    const requested = db.prepare("SELECT id, code, name FROM warehouses WHERE id = ? AND is_active = 1").get(requestedWarehouseId);
    if (requested) return requested;
  }
  return db.prepare(`SELECT w.id, w.code, w.name,
      COALESCE(SUM(CASE WHEN bal.item_id IS NOT NULL THEN bal.quantity - bal.reserved_quantity ELSE 0 END), 0) AS available_material
    FROM warehouses w
    LEFT JOIN inventory_balances bal ON bal.warehouse_id = w.id
      AND bal.item_id IN (SELECT component_item_id FROM production_bom_lines WHERE bom_id = ?)
    WHERE w.is_active = 1
    GROUP BY w.id
    ORDER BY available_material DESC, w.id
    LIMIT 1`).get(bomId);
}

export function orderDetail(db, id) {
  const order = db.prepare(`SELECT o.*, i.sku, i.name AS item_name, i.item_type, u.symbol AS unit_symbol,
    w.code AS warehouse_code, w.name AS warehouse_name, b.folio AS bom_folio, r.folio AS route_folio,
    p.folio AS parent_folio, d.folio AS demand_folio, so.folio AS sales_order_folio,
    COALESCE(c.trade_name, c.legal_name) AS sales_customer_name, sl.description AS sales_line_description,
    usr.full_name AS created_by_name
    FROM production_orders o JOIN items i ON i.id = o.item_id
    LEFT JOIN units_of_measure u ON u.id = i.unit_id JOIN warehouses w ON w.id = o.warehouse_id
    LEFT JOIN production_boms b ON b.id = o.bom_id LEFT JOIN production_routes r ON r.id = o.route_id
    LEFT JOIN production_orders p ON p.id = o.parent_order_id LEFT JOIN production_demands d ON d.id = o.demand_id
    LEFT JOIN sales_documents so ON so.id = o.sales_order_id
    LEFT JOIN sales_document_lines sl ON sl.id = o.sales_order_line_id
    LEFT JOIN customers c ON c.id = so.customer_id
    LEFT JOIN users usr ON usr.id = o.created_by WHERE o.id = ?`).get(id);
  if (!order) throw new ProductionError(404, "Orden de producción no encontrada.");
  const materials = db.prepare(`SELECT m.*, i.sku, i.name AS item_name, i.item_type, u.symbol AS unit_symbol,
    s.sku AS substitute_sku, s.name AS substitute_name,
    COALESCE((SELECT SUM(bal.quantity - bal.reserved_quantity) FROM inventory_balances bal
      WHERE bal.item_id = m.item_id AND bal.warehouse_id = o.warehouse_id), 0) AS available_quantity
    FROM production_order_materials m JOIN production_orders o ON o.id = m.order_id
    JOIN items i ON i.id = m.item_id LEFT JOIN items s ON s.id = m.substitute_item_id
    LEFT JOIN units_of_measure u ON u.id = i.unit_id WHERE m.order_id = ? ORDER BY m.id`).all(id);
  const operations = db.prepare(`SELECT op.*, r.code AS resource_code, r.name AS resource_name
    FROM production_order_operations op LEFT JOIN resources r ON r.id = op.resource_id
    WHERE op.order_id = ? ORDER BY op.sequence`).all(id);
  const children = db.prepare(`SELECT o.id, o.folio, o.status, o.planned_quantity, o.produced_quantity, i.sku, i.name AS item_name
    FROM production_orders o JOIN items i ON i.id = o.item_id WHERE o.parent_order_id = ? ORDER BY o.id`).all(id);
  const events = db.prepare(`SELECT e.*, op.name AS operation_name, usr.full_name AS created_by_name
    FROM production_events e LEFT JOIN production_order_operations op ON op.id = e.operation_id
    LEFT JOIN users usr ON usr.id = e.created_by WHERE e.order_id = ? ORDER BY e.id DESC`).all(id);
  return { order, materials, operations, children, events };
}

export function orderAction(db, id, body, userId) {
  const action = String(body.action || "");
  const order = db.prepare("SELECT * FROM production_orders WHERE id = ?").get(id);
  if (!order) throw new ProductionError(404, "Orden de producción no encontrada.");
  if (action === "release") return transition(db, order, ["planned"], "released", userId);
  if (action === "start") return startOrder(db, order, userId);
  if (action === "pause") return transition(db, order, ["in_progress"], "paused", userId);
  if (action === "resume") return transition(db, order, ["paused"], "in_progress", userId);
  if (action === "complete") return completeOrder(db, order, userId);
  if (action === "close") return closeOrder(db, order, userId);
  if (action === "cancel") return transition(db, order, ["planned", "released"], "cancelled", userId);
  if (action === "report") return reportProgress(db, order, body, userId);
  if (action === "consume") return consumeMaterial(db, order, body, userId);
  if (action === "receipt") return receiveFinished(db, order, body, userId);
  if (action === "byproduct") return receiveByproduct(db, order, body, userId);
  throw new ProductionError(400, "La acción de producción no es válida.");
}

function listOrders(db) {
  return db.prepare(`SELECT o.*, i.sku, i.name AS item_name, i.item_type, u.symbol AS unit_symbol,
    w.code AS warehouse_code, w.name AS warehouse_name, p.folio AS parent_folio,
    so.folio AS sales_order_folio, COALESCE(c.trade_name, c.legal_name) AS sales_customer_name,
    COUNT(DISTINCT child.id) AS child_count,
    (SELECT COUNT(*) FROM production_order_operations x WHERE x.order_id = o.id AND x.status = 'completed') AS completed_operations,
    (SELECT COUNT(*) FROM production_order_operations x WHERE x.order_id = o.id) AS operation_count,
    (SELECT SUM(required_quantity) FROM production_order_materials m WHERE m.order_id = o.id) AS required_materials,
    (SELECT SUM(consumed_quantity) FROM production_order_materials m WHERE m.order_id = o.id) AS consumed_materials
    FROM production_orders o JOIN items i ON i.id = o.item_id
    LEFT JOIN units_of_measure u ON u.id = i.unit_id JOIN warehouses w ON w.id = o.warehouse_id
    LEFT JOIN production_orders p ON p.id = o.parent_order_id LEFT JOIN production_orders child ON child.parent_order_id = o.id
    LEFT JOIN sales_documents so ON so.id = o.sales_order_id LEFT JOIN customers c ON c.id = so.customer_id
    LEFT JOIN production_order_operations op ON op.order_id = o.id
    GROUP BY o.id ORDER BY o.id DESC`).all();
}

function listDemands(db) {
  return db.prepare(`SELECT d.*, i.sku, i.name AS item_name, u.symbol AS unit_symbol,
    COALESCE((SELECT SUM(b.quantity - b.reserved_quantity) FROM inventory_balances b WHERE b.item_id = d.item_id), 0) AS available_quantity,
    COALESCE((SELECT SUM(o.planned_quantity - o.produced_quantity) FROM production_orders o
      WHERE o.item_id = d.item_id AND o.status IN ('planned','released','in_progress','paused')), 0) AS planned_supply
    FROM production_demands d JOIN items i ON i.id = d.item_id
    LEFT JOIN units_of_measure u ON u.id = i.unit_id ORDER BY d.required_date, d.id DESC`).all();
}

function transition(db, order, allowed, status, userId) {
  if (!allowed.includes(order.status)) throw new ProductionError(409, "La orden no puede cambiar a ese estado.");
  db.prepare("UPDATE production_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, order.id);
  addEvent(db, order.id, null, status, 0, 0, 0, "", null, userId);
  return { id: order.id, folio: order.folio, status };
}

function startOrder(db, order, userId) {
  if (!['released'].includes(order.status)) throw new ProductionError(409, "Primero libera la orden para iniciar producción.");
  db.prepare("UPDATE production_orders SET status = 'in_progress', actual_start = COALESCE(actual_start, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
  const first = db.prepare("SELECT id FROM production_order_operations WHERE order_id = ? AND status = 'pending' ORDER BY sequence LIMIT 1").get(order.id);
  if (first) db.prepare("UPDATE production_order_operations SET status = 'in_progress', started_at = CURRENT_TIMESTAMP WHERE id = ?").run(first.id);
  addEvent(db, order.id, first?.id, "start", 0, 0, 0, "", null, userId);
  return { id: order.id, folio: order.folio, status: "in_progress" };
}

function reportProgress(db, order, body, userId) {
  if (!['in_progress', 'paused'].includes(order.status)) throw new ProductionError(409, "La orden debe estar en ejecución para registrar avance.");
  const produced = nonNegativeNumber(body.producedQuantity ?? 0, "La cantidad producida");
  const rejected = nonNegativeNumber(body.rejectedQuantity ?? 0, "La cantidad rechazada");
  const waste = nonNegativeNumber(body.wasteQuantity ?? 0, "El desperdicio");
  if (produced + rejected + waste <= 0) throw new ProductionError(400, "Captura una cantidad producida, rechazada o desperdiciada.");
  const operationId = optionalId(body.operationId);
  if (operationId) {
    const op = db.prepare("SELECT * FROM production_order_operations WHERE id = ? AND order_id = ?").get(operationId, order.id);
    if (!op) throw new ProductionError(404, "Operación no encontrada.");
    const actualMinutes = nonNegativeNumber(body.actualMinutes ?? 0, "El tiempo real");
    const opStatus = body.completeOperation ? "completed" : "in_progress";
    db.prepare(`UPDATE production_order_operations SET status = ?, actual_minutes = actual_minutes + ?,
      produced_quantity = produced_quantity + ?, rejected_quantity = rejected_quantity + ?,
      started_at = COALESCE(started_at, CURRENT_TIMESTAMP), completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END
      WHERE id = ?`).run(opStatus, actualMinutes, produced, rejected, opStatus, operationId);
    if (body.completeOperation) {
      const next = db.prepare("SELECT id FROM production_order_operations WHERE order_id = ? AND sequence > ? AND status = 'pending' ORDER BY sequence LIMIT 1").get(order.id, op.sequence);
      if (next) db.prepare("UPDATE production_order_operations SET status = 'in_progress', started_at = CURRENT_TIMESTAMP WHERE id = ?").run(next.id);
    }
  }
  db.prepare(`UPDATE production_orders SET produced_quantity = produced_quantity + ?, rejected_quantity = rejected_quantity + ?,
    waste_quantity = waste_quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(produced, rejected, waste, order.id);
  addEvent(db, order.id, operationId, "progress", produced, rejected, waste, text(body.notes, 300), null, userId);
  return { id: order.id, folio: order.folio };
}

function consumeMaterial(db, order, body, userId) {
  if (!['released', 'in_progress', 'paused'].includes(order.status)) throw new ProductionError(409, "La orden no admite consumos en su estado actual.");
  const materialId = positiveId(body.materialId, "material");
  const material = db.prepare("SELECT * FROM production_order_materials WHERE id = ? AND order_id = ?").get(materialId, order.id);
  if (!material) throw new ProductionError(404, "Material requerido no encontrado.");
  const quantity = positiveNumber(body.quantity, "La cantidad consumida");
  if (Number(material.consumed_quantity) + quantity > Number(material.required_quantity) * 1.5)
    throw new ProductionError(409, "El consumo supera en más de 50% la cantidad requerida.");
  const movement = inventory.postExit(db, {
    itemId: body.useSubstitute && material.substitute_item_id ? material.substitute_item_id : material.item_id,
    quantity, fromWarehouseId: body.warehouseId || order.warehouse_id, fromLocationId: body.locationId,
    lotId: body.lotId, reason: "Consumo de producción", reference: order.folio,
  }, userId);
  db.prepare(`UPDATE production_order_materials SET consumed_quantity = consumed_quantity + ?, warehouse_id = ?, location_id = ? WHERE id = ?`)
    .run(quantity, body.warehouseId || order.warehouse_id, optionalId(body.locationId), materialId);
  addEvent(db, order.id, null, "material_consumption", quantity, 0, 0, text(body.notes, 300), movement.id, userId);
  return { id: order.id, folio: order.folio, movement };
}

function receiveFinished(db, order, body, userId) {
  if (!['in_progress', 'paused', 'completed'].includes(order.status)) throw new ProductionError(409, "La orden no admite entradas en su estado actual.");
  const quantity = positiveNumber(body.quantity, "La cantidad terminada");
  const received = Number(db.prepare("SELECT COALESCE(SUM(quantity), 0) AS value FROM production_events WHERE order_id = ? AND event_type = 'finished_receipt'").get(order.id).value);
  if (received + quantity > Number(order.produced_quantity)) throw new ProductionError(409, "Primero registra el avance producido antes de ingresar producto terminado.");
  const item = db.prepare("SELECT standard_cost FROM items WHERE id = ?").get(order.item_id);
  const movement = inventory.postEntry(db, {
    itemId: order.item_id, quantity, toWarehouseId: body.warehouseId || order.warehouse_id,
    toLocationId: body.locationId, lotId: body.lotId, unitCost: item.standard_cost,
    reason: "Entrada de producto terminado", reference: order.folio,
  }, userId);
  addEvent(db, order.id, null, "finished_receipt", quantity, 0, 0, text(body.notes, 300), movement.id, userId);
  return { id: order.id, folio: order.folio, movement };
}

function receiveByproduct(db, order, body, userId) {
  if (!['in_progress', 'paused', 'completed'].includes(order.status)) throw new ProductionError(409, "La orden no admite subproductos en su estado actual.");
  const itemId = positiveId(body.itemId, "subproducto");
  const quantity = positiveNumber(body.quantity, "La cantidad del subproducto");
  const item = db.prepare("SELECT standard_cost FROM items WHERE id = ? AND is_active = 1 AND inventory_tracked = 1").get(itemId);
  if (!item) throw new ProductionError(400, "El subproducto no está disponible para inventario.");
  const movement = inventory.postEntry(db, {
    itemId, quantity, toWarehouseId: body.warehouseId || order.warehouse_id, toLocationId: body.locationId,
    lotId: body.lotId, unitCost: item.standard_cost, reason: "Subproducto de producción", reference: order.folio,
  }, userId);
  addEvent(db, order.id, null, "byproduct", quantity, 0, 0, text(body.notes, 300), movement.id, userId);
  return { id: order.id, folio: order.folio, movement };
}

function completeOrder(db, order, userId) {
  if (!['in_progress', 'paused'].includes(order.status)) throw new ProductionError(409, "La orden no está en ejecución.");
  if (Number(order.produced_quantity) <= 0) throw new ProductionError(409, "Registra al menos una cantidad producida antes de terminar.");
  db.prepare("UPDATE production_order_operations SET status = 'completed', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP) WHERE order_id = ? AND status IN ('pending','in_progress','paused')").run(order.id);
  db.prepare("UPDATE production_orders SET status = 'completed', actual_end = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
  addEvent(db, order.id, null, "complete", 0, 0, 0, "", null, userId);
  return { id: order.id, folio: order.folio, status: "completed" };
}

function closeOrder(db, order, userId) {
  if (order.status !== 'completed') throw new ProductionError(409, "La orden debe estar terminada antes de cerrarse.");
  const pendingReceipt = Number(order.produced_quantity) - Number(db.prepare("SELECT COALESCE(SUM(quantity), 0) AS value FROM production_events WHERE order_id = ? AND event_type = 'finished_receipt'").get(order.id).value);
  if (pendingReceipt > 0.000001) throw new ProductionError(409, `Falta ingresar ${pendingReceipt} unidad(es) de producto terminado.`);
  db.prepare("UPDATE production_orders SET status = 'closed', closed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(userId, order.id);
  if (order.demand_id) db.prepare("UPDATE production_demands SET status = 'covered', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.demand_id);
  addEvent(db, order.id, null, "close", 0, 0, 0, "", null, userId);
  return { id: order.id, folio: order.folio, status: "closed" };
}

function addEvent(db, orderId, operationId, type, quantity, rejected, waste, notes, movementId, userId) {
  db.prepare(`INSERT INTO production_events
    (order_id, operation_id, event_type, quantity, rejected_quantity, waste_quantity, notes, inventory_movement_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(orderId, operationId ?? null, type, quantity, rejected, waste, notes, movementId ?? null, userId);
}

function cleanBomLine(row) {
  const componentItemId = positiveId(row.componentItemId, "material");
  const substituteItemId = optionalId(row.substituteItemId);
  if (componentItemId === substituteItemId) throw new ProductionError(400, "El sustituto debe ser diferente del material principal.");
  return { componentItemId, substituteItemId, quantity: positiveNumber(row.quantity, "La cantidad del material"),
    scrapRate: percent(row.scrapRate), notes: text(row.notes, 200) };
}

function cleanOperation(row, index) {
  return { sequence: Number.isInteger(Number(row.sequence)) && Number(row.sequence) > 0 ? Number(row.sequence) : (index + 1) * 10,
    name: requiredText(row.name, 120, "El nombre de la operación"), resourceId: optionalId(row.resourceId),
    setupMinutes: nonNegativeNumber(row.setupMinutes ?? 0, "El tiempo de preparación"),
    runMinutes: nonNegativeNumber(row.runMinutes ?? 0, "El tiempo estándar"), instructions: text(row.instructions, 500) };
}

function validateProduct(db, id) {
  if (!db.prepare("SELECT id FROM items WHERE id = ? AND is_active = 1 AND production_enabled = 1").get(id))
    throw new ProductionError(400, "El producto no existe o no está habilitado para producción.");
}

function positiveId(value, label = "registro") { const n = Number(value); if (!Number.isInteger(n) || n < 1) throw new ProductionError(400, `Selecciona un ${label} válido.`); return n; }
function optionalId(value) { return value == null || value === "" ? null : positiveId(value); }
function positiveNumber(value, label) { const n = Number(value); if (!Number.isFinite(n) || n <= 0) throw new ProductionError(400, `${label} debe ser mayor que cero.`); return round(n); }
function nonNegativeNumber(value, label) { const n = Number(value); if (!Number.isFinite(n) || n < 0) throw new ProductionError(400, `${label} no es válido.`); return round(n); }
function percent(value) { const n = Number(value || 0); if (!Number.isFinite(n) || n < 0 || n > 100) throw new ProductionError(400, "El porcentaje no es válido."); return round(n); }
function requiredText(value, max, label) { const v = text(value, max); if (!v) throw new ProductionError(400, `${label} es obligatoria.`); return v; }
function text(value, max) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""; }
function enumValue(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }
function optionalDate(value) { if (!value) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new ProductionError(400, "La fecha no es válida."); return String(value); }
function requiredDateValue(value, label) { const v = optionalDate(value); if (!v) throw new ProductionError(400, `${label} es obligatoria.`); return v; }
function optionalDateTime(value) { if (!value) return null; const d = new Date(value); if (Number.isNaN(d.getTime())) throw new ProductionError(400, "La fecha y hora no son válidas."); return d.toISOString().replace("T", " ").replace("Z", ""); }
function round(value) { return Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6; }
function placeholder(kind) { return `AUTO-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function autoFolio(prefix, id) { return `${prefix}${String(id).padStart(6, "0")}`; }
function transaction(db, work) { db.exec("BEGIN IMMEDIATE"); try { const result = work(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } }
function constraint(error, message) { const value = String(error?.message ?? ""); if (value.includes("UNIQUE constraint failed")) throw new ProductionError(409, message); if (value.includes("FOREIGN KEY constraint failed")) throw new ProductionError(400, "Una relación seleccionada no es válida."); throw error; }
