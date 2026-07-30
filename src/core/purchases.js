import { postEntryWithinTransaction, postExitWithinTransaction } from "./inventory.js";
import { createPayable } from "./finance.js";

export class PurchasesError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function options(db) {
  return {
    items: db.prepare(`SELECT i.id, i.sku, i.name, i.standard_cost, i.tax_rate, i.currency_id,
      u.symbol AS unit_symbol FROM items i LEFT JOIN units_of_measure u ON u.id = i.unit_id
      WHERE i.is_active = 1 AND i.purchase_enabled = 1 ORDER BY i.name`).all(),
    suppliers: db.prepare("SELECT id, code, legal_name, trade_name, currency_id, payment_terms_days, lead_time_days FROM suppliers WHERE is_active = 1 ORDER BY legal_name").all(),
    currencies: db.prepare("SELECT id, code, name, symbol, is_base FROM currencies WHERE is_active = 1 ORDER BY is_base DESC, code").all(),
    warehouses: db.prepare("SELECT id, code, name FROM warehouses WHERE is_active = 1 ORDER BY name").all(),
    locations: db.prepare(`SELECT l.id, l.code, l.name, l.warehouse_id FROM inventory_locations l
      JOIN warehouses w ON w.id = l.warehouse_id WHERE l.is_active = 1 AND w.is_active = 1 ORDER BY l.name`).all(),
    lots: db.prepare("SELECT id, item_id, lot_number FROM inventory_lots WHERE status = 'active' ORDER BY lot_number").all(),
    costCenters: db.prepare("SELECT id, code, name FROM finance_cost_centers WHERE is_active = 1 ORDER BY name").all(),
    requests: db.prepare(`SELECT r.id, r.folio, r.required_date, r.cost_center_id,
      COUNT(l.id) AS line_count FROM purchase_requests r JOIN purchase_request_lines l ON l.request_id = r.id
      WHERE r.status = 'approved' AND NOT EXISTS (SELECT 1 FROM purchase_orders o WHERE o.request_id = r.id AND o.status <> 'cancelled')
      GROUP BY r.id ORDER BY r.id DESC`).all(),
    comparisons: db.prepare(`SELECT c.id, c.folio, c.request_id, c.selected_supplier_id,
      r.folio AS request_folio, COALESCE(s.trade_name, s.legal_name) AS supplier_name FROM purchase_comparisons c
      JOIN purchase_requests r ON r.id = c.request_id LEFT JOIN suppliers s ON s.id = c.selected_supplier_id
      WHERE c.status = 'selected' AND NOT EXISTS (SELECT 1 FROM purchase_orders o WHERE o.comparison_id = c.id AND o.status <> 'cancelled')
      ORDER BY c.id DESC`).all(),
    orders: db.prepare(`SELECT o.id, o.folio, o.status, o.supplier_id, o.currency_id, o.total,
      s.legal_name AS supplier_name FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id
      WHERE o.status IN ('approved','partially_received','received') ORDER BY o.id DESC`).all(),
    receipts: db.prepare(`SELECT r.id, r.folio, r.order_id, o.folio AS order_folio, s.legal_name AS supplier_name
      FROM purchase_receipts r JOIN purchase_orders o ON o.id = r.order_id JOIN suppliers s ON s.id = o.supplier_id
      WHERE r.status = 'posted' AND EXISTS (SELECT 1 FROM purchase_receipt_lines l WHERE l.receipt_id = r.id AND l.quantity >
        COALESCE((SELECT SUM(rl.quantity) FROM purchase_return_lines rl JOIN purchase_returns pr ON pr.id = rl.return_id
          WHERE rl.receipt_line_id = l.id AND pr.status = 'posted'), 0)) ORDER BY r.id DESC`).all(),
  };
}

export function control(db) {
  const requests = db.prepare(`SELECT r.*, u.full_name AS requester_name, a.full_name AS approved_by_name,
    cc.code AS cost_center_code, cc.name AS cost_center_name, COUNT(l.id) AS line_count,
    COALESCE(SUM(l.quantity), 0) AS total_quantity FROM purchase_requests r
    JOIN users u ON u.id = r.requester_id LEFT JOIN users a ON a.id = r.approved_by
    LEFT JOIN finance_cost_centers cc ON cc.id = r.cost_center_id
    LEFT JOIN purchase_request_lines l ON l.request_id = r.id GROUP BY r.id ORDER BY r.id DESC`).all();
  const comparisons = db.prepare(`SELECT c.*, r.folio AS request_folio, s.code AS selected_supplier_code,
    COALESCE(s.trade_name, s.legal_name) AS selected_supplier_name, COUNT(o.id) AS offer_count,
    MIN(o.total_amount) AS lowest_amount, MAX(o.total_amount) AS highest_amount
    FROM purchase_comparisons c JOIN purchase_requests r ON r.id = c.request_id
    LEFT JOIN suppliers s ON s.id = c.selected_supplier_id
    LEFT JOIN purchase_comparison_offers o ON o.comparison_id = c.id GROUP BY c.id ORDER BY c.id DESC`).all();
  const orders = db.prepare(`SELECT o.*, r.folio AS request_folio, c.folio AS comparison_folio,
    s.code AS supplier_code, COALESCE(s.trade_name, s.legal_name) AS supplier_name,
    cur.code AS currency_code, cc.code AS cost_center_code, COUNT(l.id) AS line_count,
    COALESCE(SUM(l.quantity), 0) AS ordered_quantity, COALESCE(SUM(l.received_quantity), 0) AS received_quantity,
    COALESCE(SUM(l.returned_quantity), 0) AS returned_quantity
    FROM purchase_orders o JOIN purchase_requests r ON r.id = o.request_id
    LEFT JOIN purchase_comparisons c ON c.id = o.comparison_id JOIN suppliers s ON s.id = o.supplier_id
    JOIN currencies cur ON cur.id = o.currency_id LEFT JOIN finance_cost_centers cc ON cc.id = o.cost_center_id
    LEFT JOIN purchase_order_lines l ON l.order_id = o.id GROUP BY o.id ORDER BY o.id DESC`).all();
  const receipts = db.prepare(`SELECT r.*, o.folio AS order_folio, s.code AS supplier_code,
    COALESCE(s.trade_name, s.legal_name) AS supplier_name, w.code AS warehouse_code, w.name AS warehouse_name,
    COUNT(l.id) AS line_count, COALESCE(SUM(l.quantity), 0) AS total_quantity
    FROM purchase_receipts r JOIN purchase_orders o ON o.id = r.order_id JOIN suppliers s ON s.id = o.supplier_id
    JOIN warehouses w ON w.id = r.warehouse_id LEFT JOIN purchase_receipt_lines l ON l.receipt_id = r.id
    GROUP BY r.id ORDER BY r.id DESC`).all();
  const returns = db.prepare(`SELECT r.*, rec.folio AS receipt_folio, o.folio AS order_folio,
    COALESCE(s.trade_name, s.legal_name) AS supplier_name, w.code AS warehouse_code,
    COUNT(l.id) AS line_count, COALESCE(SUM(l.quantity), 0) AS total_quantity
    FROM purchase_returns r JOIN purchase_receipts rec ON rec.id = r.receipt_id
    JOIN purchase_orders o ON o.id = r.order_id JOIN suppliers s ON s.id = o.supplier_id
    JOIN warehouses w ON w.id = r.warehouse_id LEFT JOIN purchase_return_lines l ON l.return_id = r.id
    GROUP BY r.id ORDER BY r.id DESC`).all();
  const invoices = db.prepare(`SELECT i.*, o.folio AS order_folio, s.code AS supplier_code,
    COALESCE(s.trade_name, s.legal_name) AS supplier_name, cur.code AS currency_code,
    p.folio AS payable_folio, p.status AS payable_status, (p.original_amount - p.paid_amount) AS payable_balance
    FROM purchase_supplier_invoices i JOIN purchase_orders o ON o.id = i.order_id
    JOIN suppliers s ON s.id = i.supplier_id JOIN currencies cur ON cur.id = i.currency_id
    LEFT JOIN finance_payables p ON p.id = i.finance_payable_id ORDER BY i.id DESC`).all();
  const metrics = {
    pendingRequests: requests.filter((r) => ["draft", "submitted"].includes(r.status)).length,
    openOrders: orders.filter((r) => ["approved", "partially_received"].includes(r.status)).length,
    pendingQuantity: orders.reduce((sum, r) => sum + Math.max(0, Number(r.ordered_quantity) - Number(r.received_quantity)), 0),
    invoicedTotal: invoices.filter((r) => r.status === "posted").reduce((sum, r) => sum + Number(r.total), 0),
  };
  return { metrics, requests, comparisons, orders, receipts, returns, invoices };
}

export function requestDetail(db, id) {
  const request = db.prepare(`SELECT r.*, u.full_name AS requester_name, cc.code AS cost_center_code, cc.name AS cost_center_name
    FROM purchase_requests r JOIN users u ON u.id = r.requester_id
    LEFT JOIN finance_cost_centers cc ON cc.id = r.cost_center_id WHERE r.id = ?`).get(id);
  if (!request) throw new PurchasesError(404, "Solicitud de compra no encontrada.");
  const lines = db.prepare(`SELECT l.*, i.sku, i.name AS item_name, i.standard_cost, i.tax_rate,
    u.symbol AS unit_symbol FROM purchase_request_lines l JOIN items i ON i.id = l.item_id
    LEFT JOIN units_of_measure u ON u.id = i.unit_id WHERE l.request_id = ? ORDER BY l.id`).all(id);
  return { request, lines };
}

export function comparisonDetail(db, id) {
  const comparison = db.prepare(`SELECT c.*, r.folio AS request_folio FROM purchase_comparisons c
    JOIN purchase_requests r ON r.id = c.request_id WHERE c.id = ?`).get(id);
  if (!comparison) throw new PurchasesError(404, "Comparación no encontrada.");
  const offers = db.prepare(`SELECT o.*, s.code AS supplier_code, COALESCE(s.trade_name, s.legal_name) AS supplier_name,
    cur.code AS currency_code FROM purchase_comparison_offers o JOIN suppliers s ON s.id = o.supplier_id
    JOIN currencies cur ON cur.id = o.currency_id WHERE o.comparison_id = ? ORDER BY o.total_amount`).all(id);
  return { comparison, offers };
}

export function orderDetail(db, id) {
  const order = db.prepare(`SELECT o.*, r.folio AS request_folio, s.code AS supplier_code,
    COALESCE(s.trade_name, s.legal_name) AS supplier_name, cur.code AS currency_code,
    cc.code AS cost_center_code FROM purchase_orders o JOIN purchase_requests r ON r.id = o.request_id
    JOIN suppliers s ON s.id = o.supplier_id JOIN currencies cur ON cur.id = o.currency_id
    LEFT JOIN finance_cost_centers cc ON cc.id = o.cost_center_id WHERE o.id = ?`).get(id);
  if (!order) throw new PurchasesError(404, "Orden de compra no encontrada.");
  const lines = db.prepare(`SELECT l.*, i.sku, i.name AS item_name, i.inventory_tracked,
    u.symbol AS unit_symbol, (l.quantity - l.received_quantity) AS pending_quantity
    FROM purchase_order_lines l JOIN items i ON i.id = l.item_id LEFT JOIN units_of_measure u ON u.id = i.unit_id
    WHERE l.order_id = ? ORDER BY l.id`).all(id);
  return { order, lines };
}

export function receiptDetail(db, id) {
  const receipt = db.prepare(`SELECT r.*, o.folio AS order_folio, o.supplier_id, w.code AS warehouse_code,
    w.name AS warehouse_name FROM purchase_receipts r JOIN purchase_orders o ON o.id = r.order_id
    JOIN warehouses w ON w.id = r.warehouse_id WHERE r.id = ?`).get(id);
  if (!receipt) throw new PurchasesError(404, "Recepción no encontrada.");
  const lines = db.prepare(`SELECT l.*, i.sku, i.name AS item_name, i.inventory_tracked, u.symbol AS unit_symbol,
    loc.code AS location_code, lot.lot_number,
    COALESCE((SELECT SUM(rl.quantity) FROM purchase_return_lines rl JOIN purchase_returns pr ON pr.id = rl.return_id
      WHERE rl.receipt_line_id = l.id AND pr.status = 'posted'), 0) AS returned_quantity
    FROM purchase_receipt_lines l JOIN items i ON i.id = l.item_id
    LEFT JOIN units_of_measure u ON u.id = i.unit_id LEFT JOIN inventory_locations loc ON loc.id = l.location_id
    LEFT JOIN inventory_lots lot ON lot.id = l.lot_id WHERE l.receipt_id = ? ORDER BY l.id`).all(id);
  return { receipt, lines };
}

export function createRequest(db, body, userId) {
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) throw new PurchasesError(400, "Agrega al menos una partida a la solicitud.");
  const costCenterId = optionalId(body.costCenterId, "centro de costo");
  if (costCenterId && !db.prepare("SELECT id FROM finance_cost_centers WHERE id = ? AND is_active = 1").get(costCenterId)) throw new PurchasesError(400, "El centro de costo no está disponible.");
  return transaction(db, () => {
    const result = db.prepare(`INSERT INTO purchase_requests
      (folio, requester_id, cost_center_id, required_date, priority, notes) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(placeholder("SC"), userId, costCenterId, optionalDate(body.requiredDate, "La fecha requerida"),
        enumValue(body.priority, ["low", "medium", "high", "critical"], "medium"), text(body.notes, 1200));
    const id = Number(result.lastInsertRowid), folio = autoFolio("SC-", id);
    db.prepare("UPDATE purchase_requests SET folio = ? WHERE id = ?").run(folio, id);
    const insert = db.prepare("INSERT INTO purchase_request_lines (request_id, item_id, description, quantity) VALUES (?, ?, ?, ?)");
    const seen = new Set();
    for (const raw of lines) {
      const itemId = positiveId(raw.itemId, "artículo");
      if (seen.has(itemId)) throw new PurchasesError(400, "No repitas artículos en la solicitud."); seen.add(itemId);
      const item = db.prepare("SELECT id, name FROM items WHERE id = ? AND is_active = 1 AND purchase_enabled = 1").get(itemId);
      if (!item) throw new PurchasesError(400, "Un artículo no está disponible para compra.");
      insert.run(id, itemId, text(raw.description, 500) || item.name, positive(raw.quantity, "La cantidad"));
    }
    return { id, folio };
  });
}

export function requestAction(db, id, body, userId) {
  const row = db.prepare("SELECT * FROM purchase_requests WHERE id = ?").get(id);
  if (!row) throw new PurchasesError(404, "Solicitud no encontrada.");
  const action = String(body.action || ""); let status;
  if (action === "submit" && row.status === "draft") status = "submitted";
  else if (action === "approve" && row.status === "submitted") status = "approved";
  else if (action === "reject" && row.status === "submitted") status = "rejected";
  else if (action === "cancel" && ["draft", "submitted", "approved"].includes(row.status)) status = "cancelled";
  else throw new PurchasesError(409, "La solicitud no admite esa acción.");
  db.prepare("UPDATE purchase_requests SET status = ?, approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END, notes = CASE WHEN ? <> '' THEN notes || ' · ' || ? ELSE notes END, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(status, status, userId, text(body.comment, 500), text(body.comment, 500), id);
  return { id, folio: row.folio, status };
}

export function createComparison(db, body, userId) {
  const requestId = positiveId(body.requestId, "solicitud");
  if (!db.prepare("SELECT id FROM purchase_requests WHERE id = ? AND status = 'approved'").get(requestId)) throw new PurchasesError(409, "La solicitud debe estar aprobada.");
  const offers = Array.isArray(body.offers) ? body.offers : [];
  if (offers.length < 2) throw new PurchasesError(400, "Agrega al menos dos proveedores para comparar.");
  return transaction(db, () => {
    const result = db.prepare("INSERT INTO purchase_comparisons (folio, request_id, notes, created_by) VALUES (?, ?, ?, ?)")
      .run(placeholder("CP"), requestId, text(body.notes, 1000), userId);
    const id = Number(result.lastInsertRowid), folio = autoFolio("CP-", id);
    db.prepare("UPDATE purchase_comparisons SET folio = ? WHERE id = ?").run(folio, id);
    const insert = db.prepare(`INSERT INTO purchase_comparison_offers
      (comparison_id, supplier_id, currency_id, total_amount, lead_time_days, payment_terms_days, validity_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const seen = new Set();
    for (const raw of offers) {
      const supplierId = positiveId(raw.supplierId, "proveedor");
      if (seen.has(supplierId)) throw new PurchasesError(400, "No repitas proveedores en la comparación."); seen.add(supplierId);
      const supplier = db.prepare("SELECT * FROM suppliers WHERE id = ? AND is_active = 1").get(supplierId);
      if (!supplier) throw new PurchasesError(400, "Un proveedor no está disponible.");
      const currencyId = optionalId(raw.currencyId, "moneda") || supplier.currency_id || db.prepare("SELECT id FROM currencies WHERE is_base = 1").get()?.id;
      insert.run(id, supplierId, currencyId, nonNegative(raw.totalAmount, "El total ofertado"),
        nonNegativeInteger(raw.leadTimeDays ?? supplier.lead_time_days, "Los días de entrega"),
        nonNegativeInteger(raw.paymentTermsDays ?? supplier.payment_terms_days, "Los días de crédito"),
        optionalDate(raw.validityDate, "La vigencia"), text(raw.notes, 500));
    }
    return { id, folio };
  });
}

export function selectComparison(db, id, body, userId) {
  const comparison = db.prepare("SELECT * FROM purchase_comparisons WHERE id = ? AND status = 'draft'").get(id);
  if (!comparison) throw new PurchasesError(409, "La comparación ya fue resuelta.");
  const supplierId = positiveId(body.supplierId, "proveedor");
  if (!db.prepare("SELECT id FROM purchase_comparison_offers WHERE comparison_id = ? AND supplier_id = ?").get(id, supplierId)) throw new PurchasesError(400, "El proveedor no pertenece a la comparación.");
  transaction(db, () => {
    db.prepare("UPDATE purchase_comparison_offers SET is_selected = CASE WHEN supplier_id = ? THEN 1 ELSE 0 END WHERE comparison_id = ?").run(supplierId, id);
    db.prepare("UPDATE purchase_comparisons SET status = 'selected', selected_supplier_id = ?, selected_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(supplierId, userId, id);
  });
  return { id, folio: comparison.folio, status: "selected", supplierId };
}

export function createOrder(db, body, userId) {
  const requestId = positiveId(body.requestId, "solicitud");
  const request = requestDetail(db, requestId);
  if (request.request.status !== "approved") throw new PurchasesError(409, "La solicitud debe estar aprobada.");
  const comparisonId = optionalId(body.comparisonId, "comparación");
  let supplierId = optionalId(body.supplierId, "proveedor");
  if (comparisonId) {
    const comparison = db.prepare("SELECT * FROM purchase_comparisons WHERE id = ? AND request_id = ? AND status = 'selected'").get(comparisonId, requestId);
    if (!comparison) throw new PurchasesError(400, "La comparación no corresponde a la solicitud.");
    supplierId = comparison.selected_supplier_id;
  }
  if (!supplierId || !db.prepare("SELECT id FROM suppliers WHERE id = ? AND is_active = 1").get(supplierId)) throw new PurchasesError(400, "Selecciona un proveedor válido.");
  if (db.prepare("SELECT id FROM purchase_orders WHERE request_id = ? AND status <> 'cancelled'").get(requestId)) throw new PurchasesError(409, "La solicitud ya tiene una orden activa.");
  const currencyId = positiveId(body.currencyId, "moneda");
  const prices = Array.isArray(body.lines) ? body.lines : [];
  if (prices.length !== request.lines.length) throw new PurchasesError(400, "Captura el precio de todas las partidas.");
  return transaction(db, () => {
    const result = db.prepare(`INSERT INTO purchase_orders
      (folio, request_id, comparison_id, supplier_id, currency_id, cost_center_id, issue_date, expected_date, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(placeholder("OC"), requestId, comparisonId, supplierId, currencyId, request.request.cost_center_id,
        date(body.issueDate, "La fecha de emisión"), optionalDate(body.expectedDate, "La fecha esperada"), text(body.notes, 1200), userId);
    const id = Number(result.lastInsertRowid), folio = autoFolio("OC-", id);
    db.prepare("UPDATE purchase_orders SET folio = ? WHERE id = ?").run(folio, id);
    const insert = db.prepare(`INSERT INTO purchase_order_lines
      (order_id, request_line_id, item_id, description, quantity, unit_price, tax_rate, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    let subtotal = 0, taxTotal = 0;
    for (const reqLine of request.lines) {
      const raw = prices.find((line) => Number(line.requestLineId) === reqLine.id);
      if (!raw) throw new PurchasesError(400, "Falta una partida de la solicitud.");
      const unitPrice = nonNegative(raw.unitPrice, "El precio unitario"), taxRate = percentage(raw.taxRate ?? reqLine.tax_rate, "El impuesto");
      const base = round(reqLine.quantity * unitPrice), tax = round(base * taxRate / 100), total = round(base + tax);
      insert.run(id, reqLine.id, reqLine.item_id, reqLine.description, reqLine.quantity, unitPrice, taxRate, total);
      subtotal += base; taxTotal += tax;
    }
    db.prepare("UPDATE purchase_orders SET subtotal = ?, tax_total = ?, total = ? WHERE id = ?").run(round(subtotal), round(taxTotal), round(subtotal + taxTotal), id);
    db.prepare("UPDATE purchase_requests SET status = 'converted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(requestId);
    return { id, folio, total: round(subtotal + taxTotal) };
  });
}

export function orderAction(db, id, body, userId) {
  const order = db.prepare("SELECT * FROM purchase_orders WHERE id = ?").get(id);
  if (!order) throw new PurchasesError(404, "Orden no encontrada.");
  const action = String(body.action || ""); let status;
  if (action === "approve" && order.status === "draft") status = "approved";
  else if (action === "close" && order.status === "received") status = "closed";
  else if (action === "cancel" && ["draft", "approved"].includes(order.status) && !db.prepare("SELECT id FROM purchase_receipts WHERE order_id = ? AND status = 'posted'").get(id)) status = "cancelled";
  else throw new PurchasesError(409, "La orden no admite esa acción.");
  db.prepare("UPDATE purchase_orders SET status = ?, approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, status, userId, id);
  return { id, folio: order.folio, status };
}

export function createReceipt(db, body, userId) {
  const orderId = positiveId(body.orderId, "orden");
  const detail = orderDetail(db, orderId);
  if (!["approved", "partially_received"].includes(detail.order.status)) throw new PurchasesError(409, "La orden no admite recepciones.");
  const warehouseId = positiveId(body.warehouseId, "almacén"), locationId = optionalId(body.locationId, "ubicación"), lotId = optionalId(body.lotId, "lote");
  const lines = Array.isArray(body.lines) ? body.lines.filter((line) => Number(line.quantity) > 0) : [];
  if (!lines.length) throw new PurchasesError(400, "Captura al menos una cantidad recibida.");
  return transaction(db, () => {
    const result = db.prepare(`INSERT INTO purchase_receipts
      (folio, order_id, warehouse_id, receipt_date, supplier_reference, notes, received_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(placeholder("REC"), orderId, warehouseId, date(body.receiptDate, "La fecha de recepción"), text(body.supplierReference, 160), text(body.notes, 1000), userId);
    const id = Number(result.lastInsertRowid), folio = autoFolio("REC-", id);
    db.prepare("UPDATE purchase_receipts SET folio = ? WHERE id = ?").run(folio, id);
    const insert = db.prepare(`INSERT INTO purchase_receipt_lines
      (receipt_id, order_line_id, item_id, quantity, location_id, lot_id, inventory_movement_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const raw of lines) {
      const orderLine = detail.lines.find((line) => line.id === Number(raw.orderLineId));
      if (!orderLine) throw new PurchasesError(400, "Una partida no pertenece a la orden.");
      const quantity = positive(raw.quantity, "La cantidad recibida");
      if (quantity > Number(orderLine.pending_quantity) + 0.000001) throw new PurchasesError(409, "La recepción supera la cantidad pendiente.");
      let movementId = null;
      if (orderLine.inventory_tracked) movementId = postEntryWithinTransaction(db, { itemId: orderLine.item_id, quantity, toWarehouseId: warehouseId, toLocationId: locationId, lotId, serialId: null, unitCost: orderLine.unit_price, reason: "Recepción de compra", reference: folio, occurredAt: `${body.receiptDate} 12:00:00` }, userId).id;
      insert.run(id, orderLine.id, orderLine.item_id, quantity, locationId, lotId, movementId);
      db.prepare("UPDATE purchase_order_lines SET received_quantity = received_quantity + ? WHERE id = ?").run(quantity, orderLine.id);
    }
    updateOrderReceiptStatus(db, orderId);
    return { id, folio, orderId };
  });
}

export function createReturn(db, body, userId) {
  const receiptId = positiveId(body.receiptId, "recepción");
  const detail = receiptDetail(db, receiptId);
  const lines = Array.isArray(body.lines) ? body.lines.filter((line) => Number(line.quantity) > 0) : [];
  if (!lines.length) throw new PurchasesError(400, "Captura al menos una cantidad a devolver.");
  return transaction(db, () => {
    const result = db.prepare(`INSERT INTO purchase_returns
      (folio, receipt_id, order_id, warehouse_id, return_date, reason, returned_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(placeholder("DCP"), receiptId, detail.receipt.order_id, detail.receipt.warehouse_id,
        date(body.returnDate, "La fecha de devolución"), requiredText(body.reason, 800, "El motivo"), userId);
    const id = Number(result.lastInsertRowid), folio = autoFolio("DCP-", id);
    db.prepare("UPDATE purchase_returns SET folio = ? WHERE id = ?").run(folio, id);
    const insert = db.prepare(`INSERT INTO purchase_return_lines
      (return_id, receipt_line_id, order_line_id, item_id, quantity, inventory_movement_id)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const raw of lines) {
      const receiptLine = detail.lines.find((line) => line.id === Number(raw.receiptLineId));
      if (!receiptLine) throw new PurchasesError(400, "Una partida no pertenece a la recepción.");
      const quantity = positive(raw.quantity, "La cantidad devuelta"), available = round(receiptLine.quantity - receiptLine.returned_quantity);
      if (quantity > available + 0.000001) throw new PurchasesError(409, `Solo pueden devolverse ${available} unidad(es).`);
      let movementId = null;
      if (receiptLine.inventory_tracked) {
        movementId = postExitWithinTransaction(db, { itemId: receiptLine.item_id, quantity,
          fromWarehouseId: detail.receipt.warehouse_id, fromLocationId: receiptLine.location_id, lotId: receiptLine.lot_id,
          serialId: null, reason: "Devolución a proveedor", reference: folio, occurredAt: `${body.returnDate} 12:00:00` }, userId).id;
      }
      insert.run(id, receiptLine.id, receiptLine.order_line_id, receiptLine.item_id, quantity, movementId);
      db.prepare("UPDATE purchase_order_lines SET returned_quantity = returned_quantity + ? WHERE id = ?").run(quantity, receiptLine.order_line_id);
    }
    return { id, folio, orderId: detail.receipt.order_id };
  });
}

export function createSupplierInvoice(db, body, userId) {
  const orderId = positiveId(body.orderId, "orden"), detail = orderDetail(db, orderId);
  if (!["approved", "partially_received", "received", "closed"].includes(detail.order.status)) throw new PurchasesError(409, "La orden no admite facturas.");
  const total = positive(body.total ?? detail.order.total, "El total"), subtotal = nonNegative(body.subtotal ?? detail.order.subtotal, "El subtotal"), taxTotal = nonNegative(body.taxTotal ?? total - subtotal, "El impuesto");
  return transaction(db, () => {
    const result = db.prepare(`INSERT INTO purchase_supplier_invoices
      (folio, order_id, supplier_id, currency_id, supplier_invoice_reference, issue_date, due_date,
        subtotal, tax_total, total, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(placeholder("FCP"), orderId, detail.order.supplier_id, detail.order.currency_id,
        requiredText(body.supplierInvoiceReference, 160, "La referencia de factura"), date(body.issueDate, "La fecha de emisión"),
        optionalDate(body.dueDate, "La fecha de vencimiento"), subtotal, taxTotal, total, text(body.notes, 1000), userId);
    const id = Number(result.lastInsertRowid), folio = autoFolio("FCP-", id);
    db.prepare("UPDATE purchase_supplier_invoices SET folio = ? WHERE id = ?").run(folio, id);
    const payable = createPayable(db, { supplierId: detail.order.supplier_id, costCenterId: detail.order.cost_center_id,
      currencyId: detail.order.currency_id, invoiceReference: body.supplierInvoiceReference,
      concept: `Factura de proveedor ${body.supplierInvoiceReference} · ${detail.order.folio}`, category: "Compras",
      amount: total, issueDate: body.issueDate, dueDate: body.dueDate, notes: `Generada desde ${folio}` }, userId);
    db.prepare("UPDATE purchase_supplier_invoices SET finance_payable_id = ? WHERE id = ?").run(payable.id, id);
    if (detail.order.status === "received") db.prepare("UPDATE purchase_orders SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(orderId);
    return { id, folio, payableId: payable.id, payableFolio: payable.folio };
  });
}

function updateOrderReceiptStatus(db, orderId) {
  const lines = db.prepare("SELECT quantity, received_quantity FROM purchase_order_lines WHERE order_id = ?").all(orderId);
  const complete = lines.every((line) => Number(line.received_quantity) + 0.000001 >= Number(line.quantity));
  const any = lines.some((line) => Number(line.received_quantity) > 0);
  db.prepare("UPDATE purchase_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(complete ? "received" : any ? "partially_received" : "approved", orderId);
}
function transaction(db, work) { db.exec("BEGIN IMMEDIATE"); try { const value = work(); db.exec("COMMIT"); return value; } catch (error) { db.exec("ROLLBACK"); throw error; } }
function positiveId(value, label) { const number = Number(value); if (!Number.isInteger(number) || number < 1) throw new PurchasesError(400, `Selecciona un ${label} válido.`); return number; }
function optionalId(value, label) { return value == null || value === "" ? null : positiveId(value, label); }
function positive(value, label) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new PurchasesError(400, `${label} debe ser mayor que cero.`); return round(number); }
function nonNegative(value, label) { const number = Number(value ?? 0); if (!Number.isFinite(number) || number < 0) throw new PurchasesError(400, `${label} no es válido.`); return round(number); }
function nonNegativeInteger(value, label) { const number = Number(value ?? 0); if (!Number.isInteger(number) || number < 0) throw new PurchasesError(400, `${label} no es válido.`); return number; }
function percentage(value, label) { const number = Number(value ?? 0); if (!Number.isFinite(number) || number < 0 || number > 100) throw new PurchasesError(400, `${label} debe estar entre 0 y 100.`); return round(number); }
function requiredText(value, max, label) { const result = text(value, max); if (!result) throw new PurchasesError(400, `${label} es obligatorio.`); return result; }
function text(value, max) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""; }
function enumValue(value, values, fallback) { return values.includes(value) ? value : fallback; }
function date(value, label) { const result = String(value || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new PurchasesError(400, `${label} no es válida.`); return result; }
function optionalDate(value, label) { return value == null || value === "" ? null : date(value, label); }
function placeholder(kind) { return `AUTO-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function autoFolio(prefix, id, padding = 6) { return `${prefix}${String(id).padStart(padding, "0")}`; }
function round(value) { return Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6; }
