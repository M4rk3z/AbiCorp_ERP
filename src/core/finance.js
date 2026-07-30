export class FinanceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function options(db) {
  return {
    suppliers: db.prepare("SELECT id, code, legal_name, trade_name, currency_id FROM suppliers WHERE is_active = 1 ORDER BY legal_name").all(),
    currencies: db.prepare("SELECT id, code, name, symbol, is_base FROM currencies WHERE is_active = 1 ORDER BY is_base DESC, code").all(),
    costCenters: db.prepare("SELECT id, code, name, parent_id FROM finance_cost_centers WHERE is_active = 1 ORDER BY name").all(),
    receivables: db.prepare(`SELECT r.id, r.folio, r.original_amount, r.paid_amount,
      (r.original_amount - r.paid_amount) AS balance, i.folio AS invoice_folio,
      COALESCE(c.trade_name, c.legal_name) AS customer_name, cur.code AS currency_code
      FROM finance_receivables r JOIN sales_documents i ON i.id = r.invoice_id
      JOIN customers c ON c.id = r.customer_id JOIN currencies cur ON cur.id = r.currency_id
      WHERE r.status IN ('pending', 'partial') ORDER BY r.due_date, r.id`).all(),
    payables: db.prepare(`SELECT p.id, p.folio, p.original_amount, p.paid_amount,
      (p.original_amount - p.paid_amount) AS balance,
      COALESCE(s.trade_name, s.legal_name) AS supplier_name, cur.code AS currency_code
      FROM finance_payables p JOIN suppliers s ON s.id = p.supplier_id
      JOIN currencies cur ON cur.id = p.currency_id WHERE p.status IN ('pending', 'partial')
      ORDER BY p.due_date, p.id`).all(),
  };
}

export function control(db) {
  const receivables = db.prepare(`SELECT r.*, i.folio AS invoice_folio,
    COALESCE(c.trade_name, c.legal_name) AS customer_name, c.code AS customer_code,
    cur.code AS currency_code, cur.symbol AS currency_symbol,
    (r.original_amount - r.paid_amount) AS balance,
    CASE WHEN r.status IN ('pending','partial') AND r.due_date IS NOT NULL AND r.due_date < date('now') THEN 'overdue' ELSE r.status END AS display_status
    FROM finance_receivables r JOIN sales_documents i ON i.id = r.invoice_id
    JOIN customers c ON c.id = r.customer_id JOIN currencies cur ON cur.id = r.currency_id
    ORDER BY CASE WHEN r.status IN ('pending','partial') THEN 0 ELSE 1 END, r.due_date, r.id DESC`).all();
  const payables = db.prepare(`SELECT p.*, COALESCE(s.trade_name, s.legal_name) AS supplier_name,
    s.code AS supplier_code, cur.code AS currency_code, cur.symbol AS currency_symbol,
    cc.code AS cost_center_code, cc.name AS cost_center_name,
    (p.original_amount - p.paid_amount) AS balance,
    CASE WHEN p.status IN ('pending','partial') AND p.due_date IS NOT NULL AND p.due_date < date('now') THEN 'overdue' ELSE p.status END AS display_status
    FROM finance_payables p JOIN suppliers s ON s.id = p.supplier_id
    JOIN currencies cur ON cur.id = p.currency_id LEFT JOIN finance_cost_centers cc ON cc.id = p.cost_center_id
    ORDER BY CASE WHEN p.status IN ('pending','partial') THEN 0 ELSE 1 END, p.due_date, p.id DESC`).all();
  const collections = db.prepare(`SELECT x.*, r.folio AS receivable_folio, i.folio AS invoice_folio,
    COALESCE(c.trade_name, c.legal_name) AS customer_name, cur.code AS currency_code
    FROM finance_collections x JOIN finance_receivables r ON r.id = x.receivable_id
    JOIN sales_documents i ON i.id = r.invoice_id JOIN customers c ON c.id = r.customer_id
    JOIN currencies cur ON cur.id = r.currency_id ORDER BY x.collection_date DESC, x.id DESC LIMIT 300`).all();
  const payments = db.prepare(`SELECT x.*, p.folio AS payable_folio,
    COALESCE(s.trade_name, s.legal_name) AS supplier_name, cur.code AS currency_code,
    cc.code AS cost_center_code FROM finance_payments x JOIN finance_payables p ON p.id = x.payable_id
    JOIN suppliers s ON s.id = p.supplier_id JOIN currencies cur ON cur.id = p.currency_id
    LEFT JOIN finance_cost_centers cc ON cc.id = p.cost_center_id
    ORDER BY x.payment_date DESC, x.id DESC LIMIT 300`).all();
  const costCenters = db.prepare(`SELECT cc.*, parent.code AS parent_code, parent.name AS parent_name,
    u.full_name AS responsible_name,
    COALESCE((SELECT SUM(p.original_amount) FROM finance_payables p WHERE p.cost_center_id = cc.id AND p.status <> 'cancelled'), 0) AS committed_amount,
    COALESCE((SELECT SUM(x.amount) FROM finance_payments x JOIN finance_payables p ON p.id = x.payable_id WHERE p.cost_center_id = cc.id), 0) AS paid_amount
    FROM finance_cost_centers cc LEFT JOIN finance_cost_centers parent ON parent.id = cc.parent_id
    LEFT JOIN users u ON u.id = cc.responsible_id ORDER BY cc.is_active DESC, cc.name`).all();
  const budgets = db.prepare(`SELECT b.*, cc.code AS cost_center_code, cc.name AS cost_center_name,
    cur.code AS currency_code,
    COALESCE((SELECT SUM(p.original_amount) FROM finance_payables p
      WHERE p.cost_center_id = b.cost_center_id AND p.category = b.category AND p.status <> 'cancelled'
        AND CAST(strftime('%Y', p.issue_date) AS INTEGER) = b.fiscal_year
        AND (b.period_type = 'annual' OR CAST(strftime('%m', p.issue_date) AS INTEGER) = b.period_number)), 0) AS committed_amount,
    COALESCE((SELECT SUM(x.amount) FROM finance_payments x JOIN finance_payables p ON p.id = x.payable_id
      WHERE p.cost_center_id = b.cost_center_id AND p.category = b.category
        AND CAST(strftime('%Y', x.payment_date) AS INTEGER) = b.fiscal_year
        AND (b.period_type = 'annual' OR CAST(strftime('%m', x.payment_date) AS INTEGER) = b.period_number)), 0) AS spent_amount
    FROM finance_budgets b JOIN finance_cost_centers cc ON cc.id = b.cost_center_id
    JOIN currencies cur ON cur.id = b.currency_id ORDER BY b.fiscal_year DESC, b.period_number, cc.name, b.category`).all();
  const reconciliations = db.prepare(`SELECT r.*, u.full_name AS reconciled_by_name
    FROM finance_reconciliations r LEFT JOIN users u ON u.id = r.reconciled_by
    ORDER BY r.statement_date DESC, r.id DESC`).all();
  const metrics = db.prepare(`SELECT
    COALESCE((SELECT SUM(original_amount - paid_amount) FROM finance_receivables WHERE status IN ('pending','partial')), 0) AS receivable_balance,
    COALESCE((SELECT SUM(original_amount - paid_amount) FROM finance_payables WHERE status IN ('pending','partial')), 0) AS payable_balance,
    COALESCE((SELECT SUM(amount) FROM finance_collections WHERE substr(collection_date,1,7) = strftime('%Y-%m','now')), 0) AS collected_month,
    COALESCE((SELECT SUM(amount) FROM finance_payments WHERE substr(payment_date,1,7) = strftime('%Y-%m','now')), 0) AS paid_month,
    COALESCE((SELECT SUM(amount) FROM finance_budgets WHERE status = 'approved' AND fiscal_year = CAST(strftime('%Y','now') AS INTEGER)), 0) AS approved_budget`).get();
  return { metrics, receivables, payables, collections, payments, costCenters, budgets, reconciliations };
}

export function createCostCenter(db, body, userId) {
  const name = requiredText(body.name, 160, "El nombre del centro de costo");
  const parentId = optionalId(body.parentId, "centro padre");
  if (parentId && !db.prepare("SELECT id FROM finance_cost_centers WHERE id = ? AND is_active = 1").get(parentId))
    throw new FinanceError(400, "El centro de costo padre no está disponible.");
  const responsibleId = optionalId(body.responsibleId, "responsable");
  if (responsibleId && !db.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").get(responsibleId))
    throw new FinanceError(400, "El responsable no es válido.");
  const result = db.prepare(`INSERT INTO finance_cost_centers
    (code, name, parent_id, description, responsible_id, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(placeholder("CC"), name, parentId, text(body.description, 800), responsibleId, userId);
  const id = Number(result.lastInsertRowid), code = autoFolio("CC-", id, 5);
  db.prepare("UPDATE finance_cost_centers SET code = ? WHERE id = ?").run(code, id);
  return { id, folio: code };
}

export function createPayable(db, body, userId) {
  const supplierId = positiveId(body.supplierId, "proveedor");
  const supplier = db.prepare("SELECT id, currency_id FROM suppliers WHERE id = ? AND is_active = 1").get(supplierId);
  if (!supplier) throw new FinanceError(400, "El proveedor no está disponible.");
  const currencyId = optionalId(body.currencyId, "moneda") || supplier.currency_id || db.prepare("SELECT id FROM currencies WHERE is_base = 1").get()?.id;
  if (!currencyId || !db.prepare("SELECT id FROM currencies WHERE id = ? AND is_active = 1").get(currencyId)) throw new FinanceError(400, "La moneda no es válida.");
  const costCenterId = optionalId(body.costCenterId, "centro de costo");
  if (costCenterId && !db.prepare("SELECT id FROM finance_cost_centers WHERE id = ? AND is_active = 1").get(costCenterId))
    throw new FinanceError(400, "El centro de costo no está disponible.");
  const result = db.prepare(`INSERT INTO finance_payables
    (folio, supplier_id, cost_center_id, currency_id, invoice_reference, concept, category,
      original_amount, issue_date, due_date, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(placeholder("CXP"), supplierId, costCenterId, currencyId, text(body.invoiceReference, 120),
      requiredText(body.concept, 300, "El concepto"), text(body.category, 120) || "General",
      positive(body.amount, "El importe"), date(body.issueDate, "La fecha de emisión"),
      optionalDate(body.dueDate, "La fecha de vencimiento"), text(body.notes, 1000), userId);
  const id = Number(result.lastInsertRowid), folio = autoFolio("CXP-", id);
  db.prepare("UPDATE finance_payables SET folio = ? WHERE id = ?").run(folio, id);
  return { id, folio };
}

export function createCollection(db, body, userId) {
  const receivableId = positiveId(body.receivableId, "cuenta por cobrar");
  return transaction(db, () => {
    const account = db.prepare("SELECT * FROM finance_receivables WHERE id = ? AND status IN ('pending','partial')").get(receivableId);
    if (!account) throw new FinanceError(409, "La cuenta por cobrar ya no admite cobros.");
    const amount = positive(body.amount, "El importe del cobro"), balance = round(account.original_amount - account.paid_amount);
    if (amount > balance + 0.000001) throw new FinanceError(409, `El saldo pendiente es ${balance}.`);
    const result = db.prepare(`INSERT INTO finance_collections
      (folio, receivable_id, amount, collection_date, payment_method, bank_account, reference, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(placeholder("COB"), receivableId, amount, date(body.collectionDate, "La fecha del cobro"),
        method(body.paymentMethod), text(body.bankAccount, 120), text(body.reference, 160), text(body.notes, 1000), userId);
    const id = Number(result.lastInsertRowid), folio = autoFolio("COB-", id);
    db.prepare("UPDATE finance_collections SET folio = ? WHERE id = ?").run(folio, id);
    const paid = round(account.paid_amount + amount), status = paid + 0.000001 >= account.original_amount ? "paid" : "partial";
    db.prepare("UPDATE finance_receivables SET paid_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(paid, status, receivableId);
    db.prepare(`UPDATE sales_documents SET payment_status = ?, status = CASE WHEN ? = 'paid' THEN 'paid' ELSE status END,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(status, status, account.invoice_id);
    return { id, folio, accountFolio: account.folio, status, balance: round(account.original_amount - paid) };
  });
}

export function createPayment(db, body, userId) {
  const payableId = positiveId(body.payableId, "cuenta por pagar");
  return transaction(db, () => {
    const account = db.prepare("SELECT * FROM finance_payables WHERE id = ? AND status IN ('pending','partial')").get(payableId);
    if (!account) throw new FinanceError(409, "La cuenta por pagar ya no admite pagos.");
    const amount = positive(body.amount, "El importe del pago"), balance = round(account.original_amount - account.paid_amount);
    if (amount > balance + 0.000001) throw new FinanceError(409, `El saldo pendiente es ${balance}.`);
    const result = db.prepare(`INSERT INTO finance_payments
      (folio, payable_id, amount, payment_date, payment_method, bank_account, reference, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(placeholder("PAG"), payableId, amount, date(body.paymentDate, "La fecha del pago"),
        method(body.paymentMethod), text(body.bankAccount, 120), text(body.reference, 160), text(body.notes, 1000), userId);
    const id = Number(result.lastInsertRowid), folio = autoFolio("PAG-", id);
    db.prepare("UPDATE finance_payments SET folio = ? WHERE id = ?").run(folio, id);
    const paid = round(account.paid_amount + amount), status = paid + 0.000001 >= account.original_amount ? "paid" : "partial";
    db.prepare("UPDATE finance_payables SET paid_amount = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(paid, status, payableId);
    return { id, folio, accountFolio: account.folio, status, balance: round(account.original_amount - paid) };
  });
}

export function createBudget(db, body, userId) {
  const costCenterId = positiveId(body.costCenterId, "centro de costo");
  if (!db.prepare("SELECT id FROM finance_cost_centers WHERE id = ? AND is_active = 1").get(costCenterId)) throw new FinanceError(400, "El centro de costo no está disponible.");
  const currencyId = positiveId(body.currencyId, "moneda");
  if (!db.prepare("SELECT id FROM currencies WHERE id = ? AND is_active = 1").get(currencyId)) throw new FinanceError(400, "La moneda no está disponible.");
  const year = integerRange(body.fiscalYear, 2000, 2200, "El ejercicio fiscal");
  const periodType = ["annual", "monthly"].includes(body.periodType) ? body.periodType : "annual";
  const periodNumber = periodType === "monthly" ? integerRange(body.periodNumber, 1, 12, "El mes") : 0;
  try {
    const result = db.prepare(`INSERT INTO finance_budgets
      (folio, cost_center_id, currency_id, fiscal_year, period_type, period_number, category, amount, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(placeholder("PRE"), costCenterId, currencyId, year, periodType, periodNumber,
        requiredText(body.category, 120, "La categoría"), nonNegative(body.amount, "El presupuesto"), text(body.notes, 1000), userId);
    const id = Number(result.lastInsertRowid), folio = autoFolio("PRE-", id);
    db.prepare("UPDATE finance_budgets SET folio = ? WHERE id = ?").run(folio, id);
    return { id, folio };
  } catch (error) {
    if (String(error.message).includes("UNIQUE constraint failed")) throw new FinanceError(409, "Ya existe un presupuesto para ese centro, periodo y categoría.");
    throw error;
  }
}

export function budgetAction(db, id, body, userId) {
  const budget = db.prepare("SELECT * FROM finance_budgets WHERE id = ?").get(id);
  if (!budget) throw new FinanceError(404, "Presupuesto no encontrado.");
  const action = String(body.action || "");
  let status;
  if (action === "approve" && budget.status === "draft") status = "approved";
  else if (action === "close" && budget.status === "approved") status = "closed";
  else if (action === "cancel" && ["draft", "approved"].includes(budget.status)) status = "cancelled";
  else throw new FinanceError(409, "El presupuesto no admite esa acción en su estado actual.");
  db.prepare(`UPDATE finance_budgets SET status = ?, approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(status, status, userId, id);
  return { id, folio: budget.folio, status };
}

export function createReconciliation(db, body, userId) {
  const systemDefault = db.prepare(`SELECT
    COALESCE((SELECT SUM(amount) FROM finance_collections), 0) - COALESCE((SELECT SUM(amount) FROM finance_payments), 0) AS value`).get().value;
  const systemBalance = body.systemBalance === "" || body.systemBalance == null ? Number(systemDefault) : signed(body.systemBalance, "El saldo del sistema");
  const statementBalance = signed(body.statementBalance, "El saldo del estado de cuenta");
  const result = db.prepare(`INSERT INTO finance_reconciliations
    (folio, account_name, statement_date, statement_balance, system_balance, difference, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(placeholder("CON"), requiredText(body.accountName, 160, "La cuenta bancaria"),
      date(body.statementDate, "La fecha de corte"), statementBalance, systemBalance,
      round(statementBalance - systemBalance), text(body.notes, 1000), userId);
  const id = Number(result.lastInsertRowid), folio = autoFolio("CON-", id);
  db.prepare("UPDATE finance_reconciliations SET folio = ? WHERE id = ?").run(folio, id);
  return { id, folio, difference: round(statementBalance - systemBalance) };
}

export function reconciliationAction(db, id, body, userId) {
  const row = db.prepare("SELECT * FROM finance_reconciliations WHERE id = ?").get(id);
  if (!row) throw new FinanceError(404, "Conciliación no encontrada.");
  if (row.status !== "draft") throw new FinanceError(409, "La conciliación ya fue cerrada.");
  const notes = text(body.notes, 1000) || row.notes;
  if (Math.abs(Number(row.difference)) > 0.009 && !notes) throw new FinanceError(400, "Explica la diferencia antes de conciliar.");
  db.prepare(`UPDATE finance_reconciliations SET status = 'reconciled', notes = ?, reconciled_by = ?,
    reconciled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(notes, userId, id);
  return { id, folio: row.folio, status: "reconciled" };
}

function transaction(db, work) { db.exec("BEGIN IMMEDIATE"); try { const value = work(); db.exec("COMMIT"); return value; } catch (error) { db.exec("ROLLBACK"); throw error; } }
function positiveId(value, label) { const number = Number(value); if (!Number.isInteger(number) || number < 1) throw new FinanceError(400, `Selecciona un ${label} válido.`); return number; }
function optionalId(value, label) { return value == null || value === "" ? null : positiveId(value, label); }
function positive(value, label) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new FinanceError(400, `${label} debe ser mayor que cero.`); return round(number); }
function nonNegative(value, label) { const number = Number(value ?? 0); if (!Number.isFinite(number) || number < 0) throw new FinanceError(400, `${label} no es válido.`); return round(number); }
function signed(value, label) { const number = Number(value); if (!Number.isFinite(number)) throw new FinanceError(400, `${label} no es válido.`); return round(number); }
function integerRange(value, min, max, label) { const number = Number(value); if (!Number.isInteger(number) || number < min || number > max) throw new FinanceError(400, `${label} no es válido.`); return number; }
function requiredText(value, max, label) { const result = text(value, max); if (!result) throw new FinanceError(400, `${label} es obligatorio.`); return result; }
function text(value, max) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""; }
function method(value) { return ["cash", "transfer", "card", "check", "other"].includes(value) ? value : "transfer"; }
function date(value, label) { const result = String(value || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new FinanceError(400, `${label} no es válida.`); return result; }
function optionalDate(value, label) { return value == null || value === "" ? null : date(value, label); }
function placeholder(kind) { return `AUTO-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function autoFolio(prefix, id, padding = 6) { return `${prefix}${String(id).padStart(padding, "0")}`; }
function round(value) { return Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6; }
