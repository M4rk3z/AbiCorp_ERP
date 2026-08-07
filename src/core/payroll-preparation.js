const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class PayrollPreparationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function control(db, periodId = null) {
  const periods = db.prepare("SELECT * FROM payroll_periods ORDER BY payment_date DESC, id DESC").all();
  const selectedPeriod = selectPeriod(periods, periodId);
  if (!selectedPeriod) return { selectedPeriod: null, preparation: null, lines: [], totals: emptyTotals(), warnings: [] };
  const preparation = db.prepare("SELECT * FROM payroll_preparations WHERE period_id = ?").get(selectedPeriod.id) || null;
  if (!preparation) return { selectedPeriod, preparation: null, lines: [], totals: emptyTotals(), warnings: [] };
  const lines = preparationLines(db, preparation.id);
  return {
    selectedPeriod,
    preparation,
    lines,
    totals: summarize(lines),
    warnings: preparationWarnings(lines, selectedPeriod),
  };
}

export function generate(db, periodId, userId = null) {
  const period = requirePeriod(db, periodId);
  let preparation = db.prepare("SELECT * FROM payroll_preparations WHERE period_id = ?").get(period.id);
  if (preparation?.status === "finalized")
    throw new PayrollPreparationError(409, "La prenómina de este periodo ya está finalizada.");

  db.exec("BEGIN IMMEDIATE");
  try {
    if (!preparation) {
      const result = db.prepare(`INSERT INTO payroll_preparations (period_id, created_by) VALUES (?, ?)`)
        .run(period.id, userId);
      preparation = db.prepare("SELECT * FROM payroll_preparations WHERE id = ?").get(Number(result.lastInsertRowid));
    }

    const people = db.prepare(`SELECT e.id, e.employee_number, e.full_name, e.status,
      COALESCE(c.base_salary, 0) AS base_salary, COALESCE(c.currency_code, 'MXN') AS currency_code,
      COALESCE(l.payroll_frequency, '') AS payroll_frequency
      FROM employees e
      LEFT JOIN hr_employee_compensation_private c ON c.employee_id = e.id
      LEFT JOIN hr_employee_labor_data l ON l.employee_id = e.id
      WHERE e.status IN ('active', 'leave')
      ORDER BY e.full_name, e.id`).all();

    const incidentQuery = db.prepare(`SELECT i.* FROM hr_payroll_incidents i
      WHERE i.employee_id = ? AND i.status <> 'cancelled' AND i.start_date <= ? AND i.end_date >= ?
      AND (i.status = 'pending' OR EXISTS (
        SELECT 1 FROM payroll_preparation_incidents pi
        JOIN payroll_preparation_lines pl ON pl.id = pi.preparation_line_id
        WHERE pi.incident_id = i.id AND pl.preparation_id = ?
      )) ORDER BY i.start_date, i.id`);

    db.prepare(`DELETE FROM payroll_preparation_incidents WHERE preparation_line_id IN
      (SELECT id FROM payroll_preparation_lines WHERE preparation_id = ?)`)
      .run(preparation.id);

    for (const person of people) {
      const existing = db.prepare(`SELECT * FROM payroll_preparation_lines
        WHERE preparation_id = ? AND employee_id = ?`).get(preparation.id, person.id);
      const basePay = money(person.base_salary);
      const incidents = incidentQuery.all(person.id, period.end_date, period.start_date, preparation.id);
      const unpaidDeduction = money(Math.min(basePay, incidents.reduce((sum, incident) =>
        sum + incidentDeduction(basePay, period, incident), 0)));
      const manual = {
        otherPerceptions: money(existing?.other_perceptions),
        taxDeduction: money(existing?.tax_deduction),
        socialSecurityDeduction: money(existing?.social_security_deduction),
        otherDeductions: money(existing?.other_deductions),
        notes: String(existing?.notes || ""),
      };
      const values = calculatedValues(basePay, manual, unpaidDeduction);
      let lineId;
      if (existing) {
        db.prepare(`UPDATE payroll_preparation_lines SET currency_code = ?, base_pay = ?,
          unpaid_leave_deduction = ?, gross_pay = ?, total_deductions = ?, net_pay = ?,
          updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(person.currency_code || "MXN", basePay, unpaidDeduction, values.grossPay,
            values.totalDeductions, values.netPay, userId, existing.id);
        lineId = Number(existing.id);
      } else {
        const result = db.prepare(`INSERT INTO payroll_preparation_lines
          (preparation_id, employee_id, currency_code, base_pay, other_perceptions,
           unpaid_leave_deduction, tax_deduction, social_security_deduction, other_deductions,
           gross_pay, total_deductions, net_pay, notes, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(preparation.id, person.id, person.currency_code || "MXN", basePay,
            manual.otherPerceptions, unpaidDeduction, manual.taxDeduction,
            manual.socialSecurityDeduction, manual.otherDeductions, values.grossPay,
            values.totalDeductions, values.netPay, manual.notes, userId);
        lineId = Number(result.lastInsertRowid);
      }
      for (const incident of incidents) {
        db.prepare(`INSERT INTO payroll_preparation_incidents
          (preparation_line_id, incident_id, deduction_amount) VALUES (?, ?, ?)`)
          .run(lineId, incident.id, money(incidentDeduction(basePay, period, incident)));
      }
    }
    db.prepare("UPDATE payroll_preparations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(preparation.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return control(db, period.id);
}

export function updateLine(db, lineId, body, userId = null) {
  const line = requireLine(db, lineId);
  const preparation = db.prepare("SELECT * FROM payroll_preparations WHERE id = ?").get(line.preparation_id);
  if (preparation.status !== "draft") throw new PayrollPreparationError(409, "La prenómina finalizada ya no admite cambios.");
  const manual = {
    otherPerceptions: nonNegativeMoney(body.otherPerceptions, "Las percepciones adicionales"),
    taxDeduction: nonNegativeMoney(body.taxDeduction, "La retención de ISR"),
    socialSecurityDeduction: nonNegativeMoney(body.socialSecurityDeduction, "La deducción de seguridad social"),
    otherDeductions: nonNegativeMoney(body.otherDeductions, "Las otras deducciones"),
    notes: text(body.notes, 800),
  };
  const values = calculatedValues(Number(line.base_pay), manual, Number(line.unpaid_leave_deduction));
  db.prepare(`UPDATE payroll_preparation_lines SET other_perceptions = ?, tax_deduction = ?,
    social_security_deduction = ?, other_deductions = ?, gross_pay = ?, total_deductions = ?,
    net_pay = ?, notes = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(manual.otherPerceptions, manual.taxDeduction, manual.socialSecurityDeduction,
      manual.otherDeductions, values.grossPay, values.totalDeductions, values.netPay,
      manual.notes, userId, line.id);
  return requireLine(db, line.id);
}

export function finalize(db, preparationId, userId = null) {
  const preparation = db.prepare("SELECT * FROM payroll_preparations WHERE id = ?").get(Number(preparationId));
  if (!preparation) throw new PayrollPreparationError(404, "Prenómina no encontrada.");
  if (preparation.status === "finalized") return control(db, preparation.period_id);
  const lines = preparationLines(db, preparation.id);
  if (!lines.length) throw new PayrollPreparationError(409, "Calcula la prenómina antes de finalizarla.");
  const withoutSalary = lines.filter((line) => Number(line.base_pay) <= 0);
  if (withoutSalary.length)
    throw new PayrollPreparationError(409, `Falta registrar el salario base de ${withoutSalary.length} colaborador(es).`);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`UPDATE payroll_preparations SET status = 'finalized', finalized_by = ?,
      finalized_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(userId, preparation.id);
    db.prepare(`UPDATE hr_payroll_incidents SET status = 'processed' WHERE id IN (
      SELECT pi.incident_id FROM payroll_preparation_incidents pi
      JOIN payroll_preparation_lines pl ON pl.id = pi.preparation_line_id
      WHERE pl.preparation_id = ?
    )`).run(preparation.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return control(db, preparation.period_id);
}

function preparationLines(db, preparationId) {
  return db.prepare(`SELECT pl.*, e.employee_number, e.full_name AS employee_name,
    COALESCE(ld.payroll_frequency, '') AS payroll_frequency,
    (SELECT COUNT(*) FROM payroll_preparation_incidents pi WHERE pi.preparation_line_id = pl.id) AS incident_count
    FROM payroll_preparation_lines pl
    JOIN employees e ON e.id = pl.employee_id
    LEFT JOIN hr_employee_labor_data ld ON ld.employee_id = e.id
    WHERE pl.preparation_id = ? ORDER BY e.full_name, e.id`).all(preparationId);
}

function calculatedValues(basePay, manual, unpaidDeduction) {
  const grossPay = money(Number(basePay || 0) + Number(manual.otherPerceptions || 0));
  const totalDeductions = money(Number(unpaidDeduction || 0) + Number(manual.taxDeduction || 0)
    + Number(manual.socialSecurityDeduction || 0) + Number(manual.otherDeductions || 0));
  return { grossPay, totalDeductions, netPay: money(Math.max(0, grossPay - totalDeductions)) };
}

function incidentDeduction(basePay, period, incident) {
  if (!basePay) return 0;
  const divisor = ({ weekly: 7, biweekly: 15, monthly: 30 })[period.frequency]
    || inclusiveDays(period.start_date, period.end_date);
  const daily = basePay / Math.max(1, divisor);
  return money((Number(incident.days || 0) * daily) + (Number(incident.hours || 0) * daily / 8));
}

function summarize(lines) {
  return lines.reduce((totals, line) => {
    totals.basePay = money(totals.basePay + Number(line.base_pay || 0));
    totals.otherPerceptions = money(totals.otherPerceptions + Number(line.other_perceptions || 0));
    totals.grossPay = money(totals.grossPay + Number(line.gross_pay || 0));
    totals.unpaidLeaveDeduction = money(totals.unpaidLeaveDeduction + Number(line.unpaid_leave_deduction || 0));
    totals.taxDeduction = money(totals.taxDeduction + Number(line.tax_deduction || 0));
    totals.socialSecurityDeduction = money(totals.socialSecurityDeduction + Number(line.social_security_deduction || 0));
    totals.otherDeductions = money(totals.otherDeductions + Number(line.other_deductions || 0));
    totals.totalDeductions = money(totals.totalDeductions + Number(line.total_deductions || 0));
    totals.netPay = money(totals.netPay + Number(line.net_pay || 0));
    totals.employees += 1;
    return totals;
  }, emptyTotals());
}

function preparationWarnings(lines, period) {
  const warnings = [];
  const noSalary = lines.filter((line) => Number(line.base_pay) <= 0).length;
  if (noSalary) warnings.push(`${noSalary} colaborador(es) no tienen salario base registrado.`);
  const differentFrequency = lines.filter((line) => line.payroll_frequency && line.payroll_frequency !== period.frequency).length;
  if (differentFrequency) warnings.push(`${differentFrequency} colaborador(es) tienen una periodicidad distinta al periodo seleccionado.`);
  return warnings;
}

function selectPeriod(periods, periodId) {
  if (periodId != null && periodId !== "") return periods.find((period) => Number(period.id) === Number(periodId)) || null;
  return periods.find((period) => period.status !== "closed") || periods[0] || null;
}

function requirePeriod(db, value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new PayrollPreparationError(400, "Selecciona un periodo de nómina válido.");
  const period = db.prepare("SELECT * FROM payroll_periods WHERE id = ?").get(id);
  if (!period) throw new PayrollPreparationError(404, "Periodo de nómina no encontrado.");
  if (period.status === "closed") throw new PayrollPreparationError(409, "El periodo de nómina está cerrado.");
  return period;
}

function requireLine(db, value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new PayrollPreparationError(400, "Línea de prenómina inválida.");
  const line = db.prepare("SELECT * FROM payroll_preparation_lines WHERE id = ?").get(id);
  if (!line) throw new PayrollPreparationError(404, "Línea de prenómina no encontrada.");
  return line;
}

function nonNegativeMoney(value, label) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) throw new PayrollPreparationError(400, `${label} debe ser un importe positivo.`);
  return money(number);
}

function money(value) { return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100; }
function text(value, max) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""; }
function inclusiveDays(start, end) {
  if (!DATE_PATTERN.test(start) || !DATE_PATTERN.test(end)) return 1;
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}
function emptyTotals() {
  return { employees: 0, basePay: 0, otherPerceptions: 0, grossPay: 0, unpaidLeaveDeduction: 0,
    taxDeduction: 0, socialSecurityDeduction: 0, otherDeductions: 0, totalDeductions: 0, netPay: 0 };
}
