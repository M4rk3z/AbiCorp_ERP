import { postEntryWithinTransaction, postExitWithinTransaction } from "./inventory.js";
import { cancelWorkOrdersFromSalesOrder, createWorkOrdersFromSalesOrder } from "./production.js";

export class SalesError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DOCUMENT_PREFIX = { quote: "COT-", order: "PED-", delivery: "ENV-", return: "DEV-", invoice: "FAC-" };
const DOCUMENT_TYPES = Object.keys(DOCUMENT_PREFIX);

export function salesOptions(db) {
  return {
    customers: db.prepare(`SELECT id, code, legal_name, trade_name, currency_id, payment_terms_days
      FROM customers WHERE is_active = 1 ORDER BY legal_name`).all(),
    prospects: db.prepare(`SELECT id, folio, company_name, contact_name, currency_id, stage
      FROM sales_prospects WHERE stage NOT IN ('lost') ORDER BY company_name, contact_name`).all(),
    currencies: db.prepare("SELECT id, code, name, symbol, exchange_rate, is_base FROM currencies WHERE is_active = 1 ORDER BY is_base DESC, code").all(),
    items: db.prepare(`SELECT i.id, i.sku, i.name, i.description, i.list_price, i.tax_rate, i.currency_id,
      i.inventory_tracked, u.symbol AS unit_symbol FROM items i
      LEFT JOIN units_of_measure u ON u.id = i.unit_id
      WHERE i.is_active = 1 AND i.sales_enabled = 1 ORDER BY i.name`).all(),
    warehouses: db.prepare("SELECT id, code, name FROM warehouses WHERE is_active = 1 ORDER BY name").all(),
    locations: db.prepare(`SELECT l.id, l.code, l.name, l.warehouse_id, w.code AS warehouse_code
      FROM inventory_locations l JOIN warehouses w ON w.id = l.warehouse_id
      WHERE l.is_active = 1 AND w.is_active = 1 ORDER BY w.name, l.name`).all(),
    lots: db.prepare(`SELECT lot.id, lot.item_id, lot.lot_number FROM inventory_lots lot
      JOIN items i ON i.id = lot.item_id WHERE lot.status = 'active' AND i.is_active = 1
      ORDER BY lot.expiration_date, lot.lot_number`).all(),
    sourceDocuments: db.prepare(`SELECT d.id, d.document_type, d.folio, d.customer_id, d.prospect_id,
      d.currency_id, d.status, d.total, COALESCE(c.trade_name, c.legal_name, p.company_name, p.contact_name) AS party_name
      FROM sales_documents d LEFT JOIN customers c ON c.id = d.customer_id
      LEFT JOIN sales_prospects p ON p.id = d.prospect_id
      WHERE (d.document_type = 'quote' AND d.status = 'accepted')
         OR (d.document_type = 'order' AND d.status IN ('confirmed', 'partially_fulfilled', 'fulfilled'))
         OR (d.document_type = 'delivery' AND d.status = 'posted')
      ORDER BY d.id DESC LIMIT 200`).all(),
  };
}

export function salesControl(db) {
  const orders = db.prepare(`SELECT o.id, o.folio, o.status, o.issue_date, o.expected_date, o.total,
    o.currency_id, cur.code AS currency_code, c.code AS customer_code,
    COALESCE(c.trade_name, c.legal_name) AS customer_name, q.folio AS quote_folio,
    COALESCE((SELECT SUM(ol.quantity) FROM sales_document_lines ol WHERE ol.document_id = o.id), 0) AS ordered_quantity,
    COALESCE((SELECT SUM(dl.quantity) FROM sales_document_lines dl
      JOIN sales_documents d ON d.id = dl.document_id
      WHERE d.source_document_id = o.id AND d.document_type = 'delivery' AND d.status = 'posted'), 0) AS delivered_quantity,
    COALESCE((SELECT SUM(rl.quantity) FROM sales_document_lines rl
      JOIN sales_documents r ON r.id = rl.document_id
      JOIN sales_document_lines dl ON dl.id = rl.source_line_id
      JOIN sales_documents d ON d.id = dl.document_id
      WHERE d.source_document_id = o.id AND d.document_type = 'delivery'
        AND r.document_type = 'return' AND r.status = 'posted'), 0) AS returned_quantity,
    (SELECT COUNT(*) FROM sales_documents d WHERE d.source_document_id = o.id AND d.document_type = 'delivery' AND d.status = 'posted') AS delivery_count,
    (SELECT d.id FROM sales_documents d WHERE d.source_document_id = o.id AND d.document_type = 'delivery' AND d.status = 'posted'
      AND EXISTS (SELECT 1 FROM sales_document_lines dl WHERE dl.document_id = d.id AND dl.quantity >
        COALESCE((SELECT SUM(rl.quantity) FROM sales_document_lines rl JOIN sales_documents r ON r.id = rl.document_id
          WHERE rl.source_line_id = dl.id AND r.document_type = 'return' AND r.status = 'posted'), 0))
      ORDER BY d.id DESC LIMIT 1) AS latest_delivery_id,
    (SELECT i.id FROM sales_documents i WHERE i.source_document_id = o.id AND i.document_type = 'invoice' AND i.status <> 'cancelled' ORDER BY i.id DESC LIMIT 1) AS invoice_id,
    (SELECT i.folio FROM sales_documents i WHERE i.source_document_id = o.id AND i.document_type = 'invoice' AND i.status <> 'cancelled' ORDER BY i.id DESC LIMIT 1) AS invoice_folio,
    (SELECT i.status FROM sales_documents i WHERE i.source_document_id = o.id AND i.document_type = 'invoice' AND i.status <> 'cancelled' ORDER BY i.id DESC LIMIT 1) AS invoice_status,
    (SELECT i.payment_status FROM sales_documents i WHERE i.source_document_id = o.id AND i.document_type = 'invoice' AND i.status <> 'cancelled' ORDER BY i.id DESC LIMIT 1) AS payment_status,
    (SELECT COUNT(*) FROM production_orders po WHERE po.sales_order_id = o.id) AS production_order_count,
    (SELECT po.id FROM production_orders po WHERE po.sales_order_id = o.id ORDER BY po.id LIMIT 1) AS production_order_id,
    (SELECT GROUP_CONCAT(po.folio, ', ') FROM production_orders po WHERE po.sales_order_id = o.id ORDER BY po.id) AS production_order_folios,
    (SELECT po.status FROM production_orders po WHERE po.sales_order_id = o.id ORDER BY po.id DESC LIMIT 1) AS production_status
    FROM sales_documents o JOIN currencies cur ON cur.id = o.currency_id
    JOIN customers c ON c.id = o.customer_id LEFT JOIN sales_documents q ON q.id = o.source_document_id
    WHERE o.document_type = 'order' ORDER BY o.id DESC`).all();
  return {
    prospects: listProspects(db),
    quotes: listDocuments(db, "quote"),
    orders,
    deliveries: listDocuments(db, "delivery"),
    returns: listDocuments(db, "return"),
    invoices: listDocuments(db, "invoice"),
  };
}

export function listProspects(db) {
  return db.prepare(`SELECT p.*, cur.code AS currency_code, u.full_name AS assigned_to_name,
    c.code AS customer_code, c.legal_name AS customer_name
    FROM sales_prospects p LEFT JOIN currencies cur ON cur.id = p.currency_id
    LEFT JOIN users u ON u.id = p.assigned_to LEFT JOIN customers c ON c.id = p.customer_id
    ORDER BY CASE p.stage WHEN 'qualified' THEN 1 WHEN 'proposal' THEN 2 WHEN 'contacted' THEN 3 WHEN 'new' THEN 4 ELSE 5 END, p.id DESC`).all();
}

export function createProspect(db, body, userId) {
  const data = cleanProspect(db, body);
  return transaction(db, () => {
    const result = db.prepare(`INSERT INTO sales_prospects
      (folio, company_name, contact_name, email, phone, source, stage, estimated_value, currency_id, assigned_to, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(placeholder("PRO"), data.companyName, data.contactName,
      data.email, data.phone, data.source, data.stage, data.estimatedValue, data.currencyId, data.assignedTo, data.notes, userId);
    const id = Number(result.lastInsertRowid);
    const folio = autoFolio("PRO-", id);
    db.prepare("UPDATE sales_prospects SET folio = ? WHERE id = ?").run(folio, id);
    return { id, folio };
  });
}

export function updateProspect(db, id, body) {
  const existing = db.prepare("SELECT * FROM sales_prospects WHERE id = ?").get(id);
  if (!existing) throw new SalesError(404, "Prospecto no encontrado.");
  const data = cleanProspect(db, body);
  db.prepare(`UPDATE sales_prospects SET company_name = ?, contact_name = ?, email = ?, phone = ?, source = ?,
    stage = ?, estimated_value = ?, currency_id = ?, assigned_to = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(data.companyName, data.contactName, data.email, data.phone, data.source, data.stage,
      data.estimatedValue, data.currencyId, data.assignedTo, data.notes, id);
  return { id, folio: existing.folio };
}

export function convertProspect(db, id) {
  return transaction(db, () => {
    const prospect = db.prepare("SELECT * FROM sales_prospects WHERE id = ?").get(id);
    if (!prospect) throw new SalesError(404, "Prospecto no encontrado.");
    if (prospect.customer_id) throw new SalesError(409, "El prospecto ya fue convertido en cliente.");
    const legalName = prospect.company_name || prospect.contact_name;
    const result = db.prepare(`INSERT INTO customers
      (code, legal_name, trade_name, email, phone, currency_id, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)`).run(placeholder("CLI"), legalName, prospect.company_name || prospect.contact_name,
      prospect.email, prospect.phone, prospect.currency_id);
    const customerId = Number(result.lastInsertRowid);
    const customerCode = autoFolio("CLI-", customerId, 5);
    db.prepare("UPDATE customers SET code = ? WHERE id = ?").run(customerCode, customerId);
    db.prepare("UPDATE sales_prospects SET stage = 'won', customer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(customerId, id);
    return { id, folio: prospect.folio, customerId, customerCode };
  });
}

export function listDocuments(db, type) {
  validateType(type);
  return db.prepare(`SELECT d.*, cur.code AS currency_code,
    COALESCE(c.trade_name, c.legal_name, p.company_name, p.contact_name) AS party_name,
    c.code AS customer_code, p.folio AS prospect_folio, src.folio AS source_folio,
    u.full_name AS created_by_name, COUNT(l.id) AS line_count
    FROM sales_documents d JOIN currencies cur ON cur.id = d.currency_id
    LEFT JOIN customers c ON c.id = d.customer_id LEFT JOIN sales_prospects p ON p.id = d.prospect_id
    LEFT JOIN sales_documents src ON src.id = d.source_document_id
    LEFT JOIN users u ON u.id = d.created_by LEFT JOIN sales_document_lines l ON l.document_id = d.id
    WHERE d.document_type = ? GROUP BY d.id ORDER BY d.id DESC`).all(type);
}

export function getDocument(db, id) {
  const document = db.prepare(`SELECT d.*, cur.code AS currency_code, cur.symbol AS currency_symbol,
    COALESCE(c.trade_name, c.legal_name, p.company_name, p.contact_name) AS party_name,
    c.code AS customer_code, p.folio AS prospect_folio, src.folio AS source_folio,
    u.full_name AS created_by_name, a.full_name AS approved_by_name
    FROM sales_documents d JOIN currencies cur ON cur.id = d.currency_id
    LEFT JOIN customers c ON c.id = d.customer_id LEFT JOIN sales_prospects p ON p.id = d.prospect_id
    LEFT JOIN sales_documents src ON src.id = d.source_document_id
    LEFT JOIN users u ON u.id = d.created_by LEFT JOIN users a ON a.id = d.approved_by WHERE d.id = ?`).get(id);
  if (!document) throw new SalesError(404, "Documento comercial no encontrado.");
  const lines = db.prepare(`SELECT l.*, i.sku, i.name AS item_name, u.symbol AS unit_symbol,
    w.name AS warehouse_name, loc.name AS location_name, lot.lot_number,
    COALESCE((SELECT SUM(child.quantity) FROM sales_document_lines child
      JOIN sales_documents cd ON cd.id = child.document_id
      WHERE child.source_line_id = l.id AND cd.document_type = 'delivery' AND cd.status = 'posted'), 0) AS delivered_quantity,
    COALESCE((SELECT SUM(child.quantity) FROM sales_document_lines child
      JOIN sales_documents cd ON cd.id = child.document_id
      WHERE child.source_line_id = l.id AND cd.document_type = 'return' AND cd.status = 'posted'), 0) AS returned_quantity
    FROM sales_document_lines l JOIN items i ON i.id = l.item_id
    LEFT JOIN units_of_measure u ON u.id = i.unit_id LEFT JOIN warehouses w ON w.id = l.warehouse_id
    LEFT JOIN inventory_locations loc ON loc.id = l.location_id LEFT JOIN inventory_lots lot ON lot.id = l.lot_id
    WHERE l.document_id = ? ORDER BY l.id`).all(id);
  const productionOrders = document.document_type === "order" ? db.prepare(`SELECT po.id, po.folio, po.status,
      po.planned_quantity, po.produced_quantity, i.sku, i.name AS item_name,
      b.folio AS bom_folio, r.folio AS route_folio,
      (SELECT COUNT(*) FROM production_order_materials m WHERE m.order_id = po.id) AS material_count,
      (SELECT COUNT(*) FROM production_order_operations op WHERE op.order_id = po.id) AS operation_count
    FROM production_orders po
    JOIN items i ON i.id = po.item_id
    LEFT JOIN production_boms b ON b.id = po.bom_id
    LEFT JOIN production_routes r ON r.id = po.route_id
    WHERE po.sales_order_id = ?
    ORDER BY po.id`).all(id) : [];
  return { document, lines, productionOrders };
}

export function createDocument(db, type, body, userId) {
  validateType(type);
  const header = cleanHeader(db, type, body);
  return transaction(db, () => {
    const source = header.sourceDocumentId ? getDocument(db, header.sourceDocumentId) : null;
    validateSource(type, source);
    if (["order", "invoice"].includes(type) && source && db.prepare(`SELECT 1 FROM sales_documents
      WHERE source_document_id = ? AND document_type = ? AND status <> 'cancelled' LIMIT 1`).get(source.document.id, type))
      throw new SalesError(409, type === "order" ? "La cotización ya originó un pedido." : "El pedido ya tiene una factura activa.");
    inheritParty(header, source?.document);
    validateParty(db, type, header);
    let lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length && source && ["order", "invoice"].includes(type)) lines = source.lines.map(copySourceLine);
    if (!lines.length) throw new SalesError(400, "Agrega al menos una partida al documento.");

    const initialStatus = ["delivery", "return", "invoice"].includes(type) ? "posted" : "draft";
    const result = db.prepare(`INSERT INTO sales_documents
      (document_type, folio, customer_id, prospect_id, source_document_id, currency_id, exchange_rate,
       issue_date, valid_until, expected_date, due_date, status, payment_terms_days, fiscal_reference,
       notes, created_by, approved_by, posted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'posted' THEN CURRENT_TIMESTAMP ELSE NULL END)`)
      .run(type, placeholder(type), header.customerId, header.prospectId, header.sourceDocumentId,
        header.currencyId, header.exchangeRate, header.issueDate, header.validUntil, header.expectedDate,
        header.dueDate, initialStatus, header.paymentTermsDays, header.fiscalReference, header.notes,
        userId, initialStatus === "posted" ? userId : null, initialStatus);
    const id = Number(result.lastInsertRowid);
    const folio = autoFolio(DOCUMENT_PREFIX[type], id);
    db.prepare("UPDATE sales_documents SET folio = ? WHERE id = ?").run(folio, id);

    const totals = { subtotal: 0, discount: 0, tax: 0, total: 0 };
    for (const rawLine of lines) {
      const line = type === "delivery" ? cleanDeliveryLine(db, rawLine, source)
        : type === "return" ? cleanReturnLine(db, rawLine, source)
        : cleanCommercialLine(db, rawLine);
      const amounts = calculateLine(line);
      let movementId = null;
      if (type === "delivery" && line.inventoryTracked) {
        movementId = postExitWithinTransaction(db, {
          itemId: line.itemId, quantity: line.quantity, fromWarehouseId: line.warehouseId,
          fromLocationId: line.locationId, lotId: line.lotId, serialId: null,
          reason: "Entrega a cliente", reference: folio, occurredAt: `${header.issueDate} 12:00:00`,
        }, userId).id;
      } else if (type === "return" && line.inventoryTracked) {
        movementId = postEntryWithinTransaction(db, {
          itemId: line.itemId, quantity: line.quantity, toWarehouseId: line.warehouseId,
          toLocationId: line.locationId, lotId: line.lotId, serialId: null, unitCost: line.unitCost,
          reason: "Devolución de cliente", reference: folio, occurredAt: `${header.issueDate} 12:00:00`,
        }, userId).id;
      }
      db.prepare(`INSERT INTO sales_document_lines
        (document_id, source_line_id, item_id, description, quantity, unit_price, discount_rate, tax_rate,
         subtotal, discount_amount, tax_amount, line_total, warehouse_id, location_id, lot_id, inventory_movement_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, line.sourceLineId, line.itemId, line.description, line.quantity, line.unitPrice,
          line.discountRate, line.taxRate, amounts.subtotal, amounts.discount, amounts.tax, amounts.total,
          line.warehouseId, line.locationId, line.lotId, movementId);
      totals.subtotal += amounts.subtotal; totals.discount += amounts.discount; totals.tax += amounts.tax; totals.total += amounts.total;
    }
    db.prepare(`UPDATE sales_documents SET subtotal = ?, discount_total = ?, tax_total = ?, total = ? WHERE id = ?`)
      .run(round(totals.subtotal), round(totals.discount), round(totals.tax), round(totals.total), id);
    if (type === "delivery") updateOrderFulfillment(db, header.sourceDocumentId);
    return { id, folio, total: round(totals.total), status: initialStatus };
  });
}

export function updateDocumentStatus(db, id, action, userId) {
  return transaction(db, () => {
    const document = db.prepare("SELECT * FROM sales_documents WHERE id = ?").get(id);
    if (!document) throw new SalesError(404, "Documento comercial no encontrado.");
    let status;
    if (document.document_type === "quote") {
      const allowed = { send: ["draft", "sent"], accept: ["draft", "sent", "accepted"], reject: ["draft", "sent", "rejected"], cancel: ["draft", "sent", "cancelled"] };
      if (!allowed[action]?.includes(document.status)) throw new SalesError(409, "La cotización no admite esa acción en su estado actual.");
      status = { send: "sent", accept: "accepted", reject: "rejected", cancel: "cancelled" }[action];
    } else if (document.document_type === "order") {
      if (action === "confirm" && document.status === "draft") status = "confirmed";
      else if (action === "cancel" && ["draft", "confirmed"].includes(document.status) && !hasPostedChildren(db, id, "delivery")) status = "cancelled";
      else throw new SalesError(409, "El pedido no admite esa acción o ya tiene entregas.");
    } else if (document.document_type === "invoice") {
      if (action === "mark_paid" && document.status === "posted") status = "paid";
      else throw new SalesError(409, "La factura no admite esa acción.");
    } else throw new SalesError(409, "Los movimientos de inventario publicados no pueden cambiar de estado.");
    db.prepare(`UPDATE sales_documents SET status = ?, payment_status = CASE WHEN ? = 'paid' THEN 'paid' ELSE payment_status END,
      approved_by = CASE WHEN ? IN ('accepted', 'confirmed', 'paid') THEN ? ELSE approved_by END,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(status, status, status, userId, id);
    const production = document.document_type === "order" && action === "confirm"
      ? createWorkOrdersFromSalesOrder(db, id, userId)
      : document.document_type === "order" && action === "cancel"
        ? { cancelled: cancelWorkOrdersFromSalesOrder(db, id, userId) }
        : null;
    return { id, folio: document.folio, status, production };
  });
}

function cleanProspect(db, body) {
  const companyName = text(body.companyName, 180);
  const contactName = text(body.contactName, 160);
  if (!contactName) throw new SalesError(400, "El nombre del contacto es obligatorio.");
  const currencyId = optionalId(body.currencyId, "moneda") ?? db.prepare("SELECT id FROM currencies WHERE is_base = 1 AND is_active = 1").get()?.id ?? null;
  if (currencyId && !db.prepare("SELECT id FROM currencies WHERE id = ? AND is_active = 1").get(currencyId)) throw new SalesError(400, "La moneda no es válida.");
  const assignedTo = optionalId(body.assignedTo, "responsable");
  if (assignedTo && !db.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").get(assignedTo)) throw new SalesError(400, "El responsable no es válido.");
  return { companyName, contactName, email: text(body.email, 180), phone: text(body.phone, 50), source: text(body.source, 100),
    stage: enumValue(body.stage, ["new", "contacted", "qualified", "proposal", "won", "lost"], "new"),
    estimatedValue: nonNegative(body.estimatedValue, "El valor estimado"), currencyId, assignedTo, notes: text(body.notes, 1000) };
}

function cleanHeader(db, type, body) {
  const customerId = optionalId(body.customerId, "cliente");
  const prospectId = optionalId(body.prospectId, "prospecto");
  const sourceDocumentId = optionalId(body.sourceDocumentId, "documento origen");
  const currencyId = positiveId(body.currencyId, "moneda");
  if (!db.prepare("SELECT id FROM currencies WHERE id = ? AND is_active = 1").get(currencyId)) throw new SalesError(400, "La moneda no es válida.");
  return { customerId, prospectId, sourceDocumentId, currencyId, exchangeRate: positive(body.exchangeRate ?? 1, "El tipo de cambio"),
    issueDate: date(body.issueDate, "La fecha de emisión"), validUntil: optionalDate(body.validUntil, "La vigencia"),
    expectedDate: optionalDate(body.expectedDate, "La fecha esperada"), dueDate: optionalDate(body.dueDate, "La fecha de vencimiento"),
    paymentTermsDays: nonNegativeInteger(body.paymentTermsDays, "Los días de crédito"),
    fiscalReference: text(body.fiscalReference, 180), notes: text(body.notes, 1500), type };
}

function validateSource(type, source) {
  if (["delivery", "return"].includes(type) && !source) throw new SalesError(400, "Selecciona el documento origen.");
  if (!source) return;
  const expected = { order: "quote", delivery: "order", return: "delivery", invoice: "order" }[type];
  if (expected && source.document.document_type !== expected) throw new SalesError(400, "El documento origen no corresponde al flujo comercial.");
  if (type === "order" && source.document.status !== "accepted") throw new SalesError(409, "La cotización debe estar aceptada.");
  if (type === "delivery" && !["confirmed", "partially_fulfilled"].includes(source.document.status)) throw new SalesError(409, "El pedido debe estar confirmado y tener cantidades pendientes.");
  if (type === "return" && source.document.status !== "posted") throw new SalesError(409, "La entrega no está publicada.");
  if (type === "invoice" && !["confirmed", "partially_fulfilled", "fulfilled"].includes(source.document.status)) throw new SalesError(409, "El pedido debe estar confirmado.");
}

function inheritParty(header, source) {
  if (!source) return;
  header.customerId ||= source.customer_id;
  header.prospectId ||= source.prospect_id;
  if (!header.currencyId) header.currencyId = source.currency_id;
}

function validateParty(db, type, header) {
  if (header.customerId && !db.prepare("SELECT id FROM customers WHERE id = ? AND is_active = 1").get(header.customerId)) throw new SalesError(400, "El cliente no es válido.");
  if (header.prospectId && !db.prepare("SELECT id FROM sales_prospects WHERE id = ?").get(header.prospectId)) throw new SalesError(400, "El prospecto no es válido.");
  if (type === "quote" && !header.customerId && !header.prospectId) throw new SalesError(400, "Selecciona un cliente o prospecto.");
  if (type !== "quote" && !header.customerId) throw new SalesError(400, "El documento requiere un cliente registrado.");
}

function cleanCommercialLine(db, body) {
  const itemId = positiveId(body.itemId, "artículo");
  const item = db.prepare("SELECT id, name, description, list_price, tax_rate FROM items WHERE id = ? AND is_active = 1 AND sales_enabled = 1").get(itemId);
  if (!item) throw new SalesError(400, "El artículo no está disponible para venta.");
  return { sourceLineId: optionalId(body.sourceLineId, "partida origen"), itemId,
    description: text(body.description, 500) || item.description || item.name,
    quantity: positive(body.quantity, "La cantidad"), unitPrice: nonNegative(body.unitPrice ?? item.list_price, "El precio unitario"),
    discountRate: percentage(body.discountRate, "El descuento"), taxRate: percentage(body.taxRate ?? item.tax_rate, "El impuesto"),
    warehouseId: null, locationId: null, lotId: null };
}

function cleanDeliveryLine(db, body, source) {
  const sourceLineId = positiveId(body.sourceLineId, "partida del pedido");
  const sourceLine = source.lines.find((line) => line.id === sourceLineId);
  if (!sourceLine) throw new SalesError(400, "La partida no pertenece al pedido seleccionado.");
  const quantity = positive(body.quantity, "La cantidad a entregar");
  const pending = round(sourceLine.quantity - sourceLine.delivered_quantity);
  if (quantity > pending) throw new SalesError(409, `Solo quedan ${pending} unidad(es) pendientes en una partida del pedido.`);
  const inventoryTracked = Boolean(db.prepare("SELECT inventory_tracked FROM items WHERE id = ?").get(sourceLine.item_id)?.inventory_tracked);
  return { sourceLineId, itemId: sourceLine.item_id, description: sourceLine.description, quantity, inventoryTracked,
    unitPrice: sourceLine.unit_price, discountRate: sourceLine.discount_rate, taxRate: sourceLine.tax_rate,
    warehouseId: positiveId(body.warehouseId, "almacén"), locationId: optionalId(body.locationId, "ubicación"),
    lotId: optionalId(body.lotId, "lote") };
}

function cleanReturnLine(db, body, source) {
  const sourceLineId = positiveId(body.sourceLineId, "partida de la entrega");
  const sourceLine = source.lines.find((line) => line.id === sourceLineId);
  if (!sourceLine) throw new SalesError(400, "La partida no pertenece a la entrega seleccionada.");
  const quantity = positive(body.quantity, "La cantidad a devolver");
  const pending = round(sourceLine.quantity - sourceLine.returned_quantity);
  if (quantity > pending) throw new SalesError(409, `Solo pueden devolverse ${pending} unidad(es) de esa partida.`);
  const movement = sourceLine.inventory_movement_id ? db.prepare("SELECT unit_cost FROM inventory_movements WHERE id = ?").get(sourceLine.inventory_movement_id) : null;
  const inventoryTracked = Boolean(db.prepare("SELECT inventory_tracked FROM items WHERE id = ?").get(sourceLine.item_id)?.inventory_tracked);
  return { sourceLineId, itemId: sourceLine.item_id, description: sourceLine.description, quantity, inventoryTracked,
    unitPrice: sourceLine.unit_price, discountRate: sourceLine.discount_rate, taxRate: sourceLine.tax_rate,
    warehouseId: optionalId(body.warehouseId, "almacén") ?? sourceLine.warehouse_id,
    locationId: body.locationId === undefined ? sourceLine.location_id : optionalId(body.locationId, "ubicación"),
    lotId: body.lotId === undefined ? sourceLine.lot_id : optionalId(body.lotId, "lote"), unitCost: Number(movement?.unit_cost ?? 0) };
}

function copySourceLine(line) {
  return { sourceLineId: line.id, itemId: line.item_id, description: line.description, quantity: line.quantity,
    unitPrice: line.unit_price, discountRate: line.discount_rate, taxRate: line.tax_rate };
}

function calculateLine(line) {
  const subtotal = round(line.quantity * line.unitPrice);
  const discount = round(subtotal * line.discountRate / 100);
  const tax = round((subtotal - discount) * line.taxRate / 100);
  return { subtotal, discount, tax, total: round(subtotal - discount + tax) };
}

function updateOrderFulfillment(db, orderId) {
  const lines = getDocument(db, orderId).lines;
  const delivered = lines.filter((line) => Number(line.delivered_quantity) > 0).length;
  const complete = lines.every((line) => Number(line.delivered_quantity) + 0.0000001 >= Number(line.quantity));
  const status = complete ? "fulfilled" : delivered ? "partially_fulfilled" : "confirmed";
  db.prepare("UPDATE sales_documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, orderId);
}

function hasPostedChildren(db, id, type) {
  return Boolean(db.prepare("SELECT 1 FROM sales_documents WHERE source_document_id = ? AND document_type = ? AND status = 'posted' LIMIT 1").get(id, type));
}

function validateType(type) { if (!DOCUMENT_TYPES.includes(type)) throw new SalesError(404, "Sección de ventas no encontrada."); }
function transaction(db, work) { db.exec("BEGIN IMMEDIATE"); try { const value = work(); db.exec("COMMIT"); return value; } catch (error) { db.exec("ROLLBACK"); throw error; } }
function positiveId(value, label) { const number = Number(value); if (!Number.isInteger(number) || number < 1) throw new SalesError(400, `Selecciona un ${label} válido.`); return number; }
function optionalId(value, label) { return value == null || value === "" ? null : positiveId(value, label); }
function positive(value, label) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new SalesError(400, `${label} debe ser mayor que cero.`); return round(number); }
function nonNegative(value, label) { const number = Number(value ?? 0); if (!Number.isFinite(number) || number < 0) throw new SalesError(400, `${label} no es válido.`); return round(number); }
function nonNegativeInteger(value, label) { const number = Number(value ?? 0); if (!Number.isInteger(number) || number < 0) throw new SalesError(400, `${label} no es válido.`); return number; }
function percentage(value, label) { const number = Number(value ?? 0); if (!Number.isFinite(number) || number < 0 || number > 100) throw new SalesError(400, `${label} debe estar entre 0 y 100.`); return round(number); }
function date(value, label) { const result = String(value ?? ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new SalesError(400, `${label} no es válida.`); return result; }
function optionalDate(value, label) { return value == null || value === "" ? null : date(value, label); }
function enumValue(value, options, fallback) { return options.includes(value) ? value : fallback; }
function text(value, max) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""; }
function placeholder(kind) { return `AUTO-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function autoFolio(prefix, id, padding = 6) { return `${prefix}${String(id).padStart(padding, "0")}`; }
function round(value) { return Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6; }
