export class HrError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function options(db, { syncVacation = true, includeEmployees = true, managedCompanyId = null } = {}) {
  if (syncVacation) syncVacationPlans(db);
  const catalogs = laborCatalogOptions(db);
  if (managedCompanyId) {
    catalogs.companies = catalogs.companies.filter((row) => Number(row.id) === Number(managedCompanyId));
    catalogs.workCenters = catalogs.workCenters.filter((row) => Number(row.company_id) === Number(managedCompanyId));
    catalogs.departments = catalogs.departments.filter((row) => Number(row.company_id) === Number(managedCompanyId));
  }
  return {
    employees: includeEmployees ? db.prepare(`SELECT e.id, e.employee_number, e.full_name, e.area_id, e.status,
      e.company_id, e.work_center_id, e.department_id,
      p.employment_type, p.vacation_balance, p.vacation_debt,
      p.vacation_balance - p.vacation_debt AS vacation_available,
      p.vacation_cycle_year, vp.name AS vacation_plan_name, vp.annual_days AS vacation_plan_days
      FROM employees e
      LEFT JOIN hr_employee_profiles p ON p.employee_id = e.id
      LEFT JOIN hr_vacation_plans vp ON vp.id = p.vacation_plan_id
      ORDER BY e.full_name`).all() : [],
    ...catalogs,
  };
}

// PostgreSQL paga latencia por cada viaje al servidor. Los ocho catálogos que
// necesita RH se obtienen en una sola consulta y después se reconstruyen con la
// misma forma que tenían las consultas individuales.
function laborCatalogOptions(db) {
  const rows = db.prepare(`
    SELECT 'area' AS catalog_type, CAST(id AS TEXT) AS id, CAST(code AS TEXT) AS code,
      CAST(name AS TEXT) AS name, CAST(description AS TEXT) AS description,
      NULL AS profile_education, NULL AS profile_experience, NULL AS profile_knowledge,
      NULL AS profile_skills, NULL AS profile_competencies,
      CAST(is_active AS TEXT) AS is_active,
      NULL AS company_id, NULL AS work_center_id, NULL AS trade_name, NULL AS center_type,
      NULL AS start_time, NULL AS end_time, NULL AS work_days, NULL AS break_minutes,
      NULL AS schedule_json, NULL AS annual_days, NULL AS min_service_years,
      NULL AS max_service_years, CAST(created_at AS TEXT) AS created_at,
      CAST(updated_at AS TEXT) AS updated_at
    FROM areas
    UNION ALL
    SELECT 'company', CAST(id AS TEXT), CAST(code AS TEXT), CAST(legal_name AS TEXT), NULL,
      NULL, NULL, NULL, NULL, NULL,
      CAST(is_active AS TEXT), NULL, NULL, CAST(trade_name AS TEXT), NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL, CAST(created_at AS TEXT), CAST(updated_at AS TEXT)
    FROM companies WHERE is_active = 1
    UNION ALL
    SELECT 'work_center', CAST(id AS TEXT), CAST(code AS TEXT), CAST(name AS TEXT), NULL,
      NULL, NULL, NULL, NULL, NULL,
      CAST(is_active AS TEXT), CAST(company_id AS TEXT), NULL, NULL, CAST(center_type AS TEXT),
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      CAST(created_at AS TEXT), CAST(updated_at AS TEXT)
    FROM hr_work_centers WHERE is_active = 1
    UNION ALL
    SELECT 'department', CAST(id AS TEXT), CAST(code AS TEXT), CAST(name AS TEXT), NULL,
      NULL, NULL, NULL, NULL, NULL,
      CAST(is_active AS TEXT), CAST(company_id AS TEXT), CAST(work_center_id AS TEXT),
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      CAST(created_at AS TEXT), CAST(updated_at AS TEXT)
    FROM hr_departments WHERE is_active = 1
    UNION ALL
    SELECT 'position', CAST(id AS TEXT), CAST(code AS TEXT), CAST(name AS TEXT),
      CAST(description AS TEXT), CAST(profile_education AS TEXT), CAST(profile_experience AS TEXT),
      CAST(profile_knowledge AS TEXT), CAST(profile_skills AS TEXT), CAST(profile_competencies AS TEXT),
      CAST(is_active AS TEXT),
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      CAST(created_at AS TEXT), CAST(updated_at AS TEXT)
    FROM hr_job_positions WHERE is_active = 1
    UNION ALL
    SELECT 'shift', CAST(id AS TEXT), CAST(code AS TEXT), CAST(name AS TEXT), NULL,
      NULL, NULL, NULL, NULL, NULL,
      CAST(is_active AS TEXT), NULL, NULL, NULL, NULL, CAST(start_time AS TEXT),
      CAST(end_time AS TEXT), CAST(work_days AS TEXT), CAST(break_minutes AS TEXT),
      CAST(schedule_json AS TEXT), NULL, NULL, NULL,
      CAST(created_at AS TEXT), CAST(updated_at AS TEXT)
    FROM hr_work_shifts WHERE is_active = 1
    UNION ALL
    SELECT 'vacation_plan', CAST(id AS TEXT), CAST(code AS TEXT), CAST(name AS TEXT),
      CAST(description AS TEXT), NULL, NULL, NULL, NULL, NULL,
      CAST(is_active AS TEXT), NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, CAST(annual_days AS TEXT),
      CAST(min_service_years AS TEXT), CAST(max_service_years AS TEXT),
      CAST(created_at AS TEXT), CAST(updated_at AS TEXT)
    FROM hr_vacation_plans WHERE is_active = 1
    ORDER BY catalog_type, name`).all();
  for (const row of rows) {
    for (const key of ["id", "is_active", "company_id", "work_center_id", "break_minutes",
      "annual_days", "min_service_years", "max_service_years"]) {
      if (row[key] != null && row[key] !== "") row[key] = Number(row[key]);
    }
  }
  const ofType = (type) => rows.filter((row) => row.catalog_type === type);
  const areaCatalog = ofType("area").map((row) => pick(row,
    ["id", "code", "name", "description", "is_active"]));
  return {
    areas: areaCatalog.filter((row) => row.is_active).map((row) => pick(row, ["id", "code", "name"])),
    areaCatalog,
    companies: ofType("company").map((row) => ({
      id: row.id, code: row.code, legal_name: row.name, trade_name: row.trade_name,
    })),
    workCenters: ofType("work_center").map((row) => pick(row,
      ["id", "company_id", "code", "name", "center_type"])),
    departments: ofType("department").map((row) => pick(row,
      ["id", "company_id", "work_center_id", "code", "name"])),
    jobPositions: ofType("position").map((row) => pick(row,
      ["id", "code", "name", "description", "profile_education", "profile_experience",
        "profile_knowledge", "profile_skills", "profile_competencies",
        "is_active", "created_at", "updated_at"])),
    workShifts: ofType("shift").map((row) => pick(row,
      ["id", "code", "name", "start_time", "end_time", "work_days", "break_minutes",
        "schedule_json", "is_active", "created_at", "updated_at"])),
    vacationPlans: ofType("vacation_plan")
      .map((row) => pick(row, ["id", "code", "name", "annual_days", "min_service_years",
        "max_service_years", "description", "is_active", "created_at", "updated_at"]))
      .sort((left, right) => Number(left.annual_days) - Number(right.annual_days)
        || String(left.name).localeCompare(String(right.name), "es")),
  };
}

function pick(source, keys) {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

export function control(db) {
  syncVacationPlans(db);
  const people = db.prepare(`SELECT e.*, a.name AS area_name, c.legal_name AS company_name,
    wc.name AS work_center_name, d.name AS department_name, m.full_name AS manager_name,
    p.manager_employee_id, p.employment_type, p.shift, p.work_schedule,
    p.emergency_contact, p.emergency_phone, p.emergency_relationship, p.vacation_balance, p.notes AS profile_notes,
    p.vacation_debt, p.vacation_balance - p.vacation_debt AS vacation_available,
    p.vacation_cycle_year, p.vacation_renewed_at,
    p.photo_filename, p.photo_mime, p.photo_original_name, p.work_shift_id, p.vacation_plan_id,
    p.contract_end_date, p.organization_name, p.organization_details, p.organization_contact_name,
    p.organization_contact_phone, p.organization_contact_email, p.advisor_name, p.advisor_phone,
    p.advisor_email, p.service_start_date, p.service_end_date, p.required_service_hours,
    jp.name AS job_position_name, ws.name AS shift_name, ws.start_time AS shift_start_time,
    ws.end_time AS shift_end_time, ws.work_days AS shift_work_days, ws.break_minutes AS shift_break_minutes,
    ws.schedule_json AS shift_schedule_json,
    vp.name AS vacation_plan_name, vp.annual_days AS vacation_plan_days,
    pd.birth_date, pd.gender, pd.nationality, pd.marital_status, pd.street, pd.exterior_number,
    pd.interior_number, pd.neighborhood, pd.municipality, pd.state AS address_state,
    pd.postal_code, pd.country,
    fd.curp, fd.rfc, fd.nss, fd.tax_regime, fd.fiscal_postal_code,
    ld.contract_type, ld.contract_number, ld.contract_start_date,
    ld.payroll_frequency, ld.union_status, ld.termination_date, ld.termination_reason,
    cp.base_salary, cp.currency_code, cp.payment_method, cp.bank_reference
    FROM employees e
    LEFT JOIN areas a ON a.id = e.area_id
    LEFT JOIN companies c ON c.id = e.company_id
    LEFT JOIN hr_work_centers wc ON wc.id = e.work_center_id
    LEFT JOIN hr_departments d ON d.id = e.department_id
    LEFT JOIN hr_employee_profiles p ON p.employee_id = e.id
    LEFT JOIN employees m ON m.id = p.manager_employee_id
    LEFT JOIN hr_job_positions jp ON jp.id = e.position_id
    LEFT JOIN hr_work_shifts ws ON ws.id = p.work_shift_id
    LEFT JOIN hr_vacation_plans vp ON vp.id = p.vacation_plan_id
    LEFT JOIN hr_employee_personal_data pd ON pd.employee_id = e.id
    LEFT JOIN hr_employee_fiscal_data fd ON fd.employee_id = e.id
    LEFT JOIN hr_employee_labor_data ld ON ld.employee_id = e.id
    LEFT JOIN hr_employee_compensation_private cp ON cp.employee_id = e.id
    ORDER BY e.status = 'active' DESC, e.full_name`).all();
  const leaves = db.prepare(`SELECT l.*, e.employee_number, e.full_name AS employee_name, e.department_id, i.folio AS incident_folio
    FROM hr_leave_requests l JOIN employees e ON e.id = l.employee_id
    LEFT JOIN safety_incidents i ON i.id = l.safety_incident_id ORDER BY l.created_at DESC, l.id DESC`).all();
  const attendance = db.prepare(`SELECT a.*, e.employee_number, e.full_name AS employee_name
    FROM hr_attendance a JOIN employees e ON e.id = a.employee_id ORDER BY a.occurred_at DESC, a.id DESC LIMIT 200`).all();
  const fileStatusContext = employeeFileStatusContext(db);
  const leavePolicy = db.prepare("SELECT * FROM hr_portal_settings WHERE id = 1").get();
  const coverageContext = leaveCoverageContext(db, people, leaves, leavePolicy);
  for (const leave of leaves) leave.coverage = measureLeaveCoverageFromContext(coverageContext,
    leave.department_id, leave.employee_id, leave.start_date, leave.end_date);
  for (const person of people) {
    Object.assign(person, employeeFileStatus(person, fileStatusContext));
    person.service_total_days = serviceDayCount(person.service_start_date, person.service_end_date);
    person.planned_service_hours = plannedShiftHours(person, person.service_start_date, person.service_end_date);
    const elapsedServiceEnd = person.service_start_date && today() >= person.service_start_date
      ? (person.service_end_date && today() > person.service_end_date ? person.service_end_date : today())
      : null;
    person.completed_service_hours = Math.min(Number(person.required_service_hours || 0),
      plannedShiftHours(person, person.service_start_date, elapsedServiceEnd));
    person.remaining_service_hours = Math.max(0,
      Math.round((Number(person.required_service_hours || 0) - person.completed_service_hours) * 100) / 100);
    person.service_progress_percent = Number(person.required_service_hours || 0) > 0
      ? Math.min(100, Math.round(person.completed_service_hours / Number(person.required_service_hours) * 100))
      : 0;
  }
  const currentMonth = today().slice(0, 7);
  const activePeople = people.filter((row) => row.status === "active").length;
  const staffEntriesMonth = people.filter((row) => String(row.hire_date || row.created_at || "").slice(0, 7) === currentMonth).length;
  const staffExitsMonth = people.filter((row) => row.status === "inactive"
    && String(row.updated_at || "").slice(0, 7) === currentMonth).length;
  const turnoverRate = Math.round(staffExitsMonth / Math.max(1, activePeople + staffExitsMonth / 2) * 1000) / 10;
  return {
    people, leaves, attendance,
    indicators: {
      activePeople,
      pendingRequests: leaves.filter((row) => row.status === "submitted").length,
      awayToday: leaves.filter((row) => row.status === "approved" && row.start_date <= today() && row.end_date >= today()).length,
      staffEntriesMonth,
      staffExitsMonth,
      turnoverRate,
    },
  };
}

export function createPerson(db, body, userId = null, { withinTransaction = false } = {}) {
  const fullName = requiredText(body.fullName, 180, "El nombre completo");
  const companyId = optionalExistingId(db, "companies", body.companyId, "empresa");
  const workCenterId = optionalExistingId(db, "hr_work_centers", body.workCenterId, "centro de trabajo");
  const departmentId = optionalExistingId(db, "hr_departments", body.departmentId, "departamento");
  const managerEmployeeId = optionalExistingId(db, "employees", body.managerEmployeeId, "jefe inmediato");
  validateLaborPlacement(db, { companyId, workCenterId, departmentId });
  const areaId = optionalExistingId(db, "areas", body.areaId, "área");
  const position = optionalCatalogRecord(db, "hr_job_positions", body.positionId, "puesto");
  const employmentType = enumValue(body.employmentType, ["permanent", "temporary", "contractor", "intern"], "permanent");
  const hireDate = optionalDate(body.hireDate);
  const employment = employmentDetails(body, employmentType, hireDate);
  const workShift = employmentType === "contractor" ? null : optionalCatalogRecord(db, "hr_work_shifts", body.workShiftId, "turno");
  const vacationPlan = employmentType === "permanent" ? automaticVacationPlan(db, hireDate) : null;
  const work = () => {
    const result = db.prepare(`INSERT INTO employees
      (employee_number, full_name, email, phone, area_id, position, position_id, hire_date, status,
       company_id, work_center_id, department_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`)
      .run(placeholder("EMP"), fullName, email(body.email), text(body.phone, 40), areaId,
        position?.name || "", position?.id || null, hireDate, companyId, workCenterId, departmentId);
    const id = Number(result.lastInsertRowid), folio = `E-${String(id).padStart(5, "0")}`;
    db.prepare("UPDATE employees SET employee_number = ? WHERE id = ?").run(folio, id);
    db.prepare(`INSERT INTO hr_employee_profiles
      (employee_id, manager_employee_id, employment_type, shift, work_schedule, work_shift_id, emergency_contact, emergency_phone,
       emergency_relationship,
       vacation_balance, vacation_plan_id, notes, contract_end_date, organization_name, organization_details,
       organization_contact_name, organization_contact_phone, organization_contact_email, advisor_name,
       advisor_phone, advisor_email, service_start_date, service_end_date, required_service_hours)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, managerEmployeeId, employmentType,
        legacyShift(workShift), workShift ? shiftSchedule(workShift) : "", workShift?.id || null,
        text(body.emergencyContact, 180), text(body.emergencyPhone, 40), text(body.emergencyRelationship, 80),
        vacationPlan?.annual_days || 0, vacationPlan?.id || null, text(body.notes, 800),
        employment.contractEndDate, employment.organizationName, employment.organizationDetails,
        employment.organizationContactName, employment.organizationContactPhone,
        employment.organizationContactEmail, employment.advisorName, employment.advisorPhone,
        employment.advisorEmail, employment.serviceStartDate, employment.serviceEndDate,
        employment.requiredServiceHours);
    saveEmployeeIdentityDetails(db, id, body, employmentType, hireDate, employment.contractEndDate);
    db.prepare(`INSERT INTO hr_employee_history
      (employee_id, event_type, new_data_json, reason, changed_by)
      VALUES (?, 'hire', ?, ?, ?)`)
      .run(id, JSON.stringify({ status: "active", areaId, positionId: position?.id || null, hireDate }),
        text(body.changeReason, 500) || "Alta inicial del trabajador", userId);
    return { id, folio };
  };
  return withinTransaction ? work() : transaction(db, work);
}

export function updatePerson(db, id, body, userId = null) {
  const employeeId = positiveId(id, "empleado");
  const existing = db.prepare(`SELECT e.employee_number, e.area_id, e.position_id, e.status,
    e.company_id, e.work_center_id, e.department_id,
    p.manager_employee_id, p.vacation_plan_id, p.vacation_balance
    FROM employees e LEFT JOIN hr_employee_profiles p ON p.employee_id = e.id WHERE e.id = ?`).get(employeeId);
  if (!existing) throw new HrError(404, "Trabajador no encontrado.");
  const fullName = requiredText(body.fullName, 180, "El nombre completo");
  const companyId = Object.hasOwn(body, "companyId")
    ? optionalExistingId(db, "companies", body.companyId, "empresa") : existing.company_id;
  const workCenterId = Object.hasOwn(body, "workCenterId")
    ? optionalExistingId(db, "hr_work_centers", body.workCenterId, "centro de trabajo") : existing.work_center_id;
  const departmentId = Object.hasOwn(body, "departmentId")
    ? optionalExistingId(db, "hr_departments", body.departmentId, "departamento") : existing.department_id;
  const managerEmployeeId = Object.hasOwn(body, "managerEmployeeId")
    ? optionalExistingId(db, "employees", body.managerEmployeeId, "jefe inmediato") : existing.manager_employee_id;
  if (managerEmployeeId === employeeId) throw new HrError(400, "El trabajador no puede ser su propio jefe inmediato.");
  validateLaborPlacement(db, { companyId, workCenterId, departmentId });
  const areaId = optionalExistingId(db, "areas", body.areaId, "área");
  const position = optionalCatalogRecord(db, "hr_job_positions", body.positionId, "puesto");
  const employmentType = enumValue(body.employmentType, ["permanent", "temporary", "contractor", "intern"], "permanent");
  const hireDate = optionalDate(body.hireDate);
  const employment = employmentDetails(body, employmentType, hireDate);
  const workShift = employmentType === "contractor" ? null : optionalCatalogRecord(db, "hr_work_shifts", body.workShiftId, "turno");
  const vacationPlan = employmentType === "permanent" ? automaticVacationPlan(db, hireDate) : null;
  const status = enumRequired(body.status, ["active", "leave", "inactive"], "estado");
  if (existing.status !== "inactive" && status === "inactive")
    throw new HrError(400, "Utiliza la acción Registrar baja para capturar su fecha y motivo.");
  const vacationPlanId = vacationPlan?.id || null;
  const vacationBalance = employmentType === "permanent"
    ? (Number(existing.vacation_plan_id || 0) === Number(vacationPlanId || 0)
      ? existing.vacation_balance
      : vacationPlan?.annual_days || 0)
    : 0;
  try {
    return transaction(db, () => {
      db.prepare(`UPDATE employees SET full_name = ?, email = ?, phone = ?, area_id = ?, position = ?,
        position_id = ?, hire_date = ?, status = ?, company_id = ?, work_center_id = ?, department_id = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(fullName, email(body.email), text(body.phone, 40), areaId, position?.name || "", position?.id || null,
          hireDate, status, companyId, workCenterId, departmentId, employeeId);
      db.prepare(`UPDATE hr_employee_profiles SET employment_type = ?, shift = ?, work_schedule = ?,
        work_shift_id = ?, manager_employee_id = ?, emergency_contact = ?, emergency_phone = ?,
        emergency_relationship = ?, vacation_balance = ?,
        vacation_plan_id = ?, notes = ?, contract_end_date = ?, organization_name = ?,
        organization_details = ?, organization_contact_name = ?, organization_contact_phone = ?,
        organization_contact_email = ?, advisor_name = ?, advisor_phone = ?, advisor_email = ?,
        service_start_date = ?, service_end_date = ?, required_service_hours = ?,
        updated_at = CURRENT_TIMESTAMP WHERE employee_id = ?`)
        .run(employmentType,
          legacyShift(workShift), workShift ? shiftSchedule(workShift) : "", workShift?.id || null, managerEmployeeId,
          text(body.emergencyContact, 180), text(body.emergencyPhone, 40),
          text(body.emergencyRelationship, 80), vacationBalance,
          vacationPlanId, text(body.notes, 800), employment.contractEndDate, employment.organizationName,
          employment.organizationDetails, employment.organizationContactName,
          employment.organizationContactPhone, employment.organizationContactEmail,
          employment.advisorName, employment.advisorPhone, employment.advisorEmail,
          employment.serviceStartDate, employment.serviceEndDate, employment.requiredServiceHours, employeeId);
      saveEmployeeIdentityDetails(db, employeeId, body, employmentType, hireDate, employment.contractEndDate);
      const changes = [
        ["area_change", existing.area_id, areaId],
        ["position_change", existing.position_id, position?.id || null],
        ["company_change", existing.company_id, companyId],
        ["center_change", existing.work_center_id, workCenterId],
        ["department_change", existing.department_id, departmentId],
        ["manager_change", existing.manager_employee_id, managerEmployeeId],
      ];
      for (const [eventType, previousValue, newValue] of changes) {
        if (Number(previousValue || 0) === Number(newValue || 0)) continue;
        db.prepare(`INSERT INTO hr_employee_history
          (employee_id, event_type, previous_data_json, new_data_json, reason, changed_by)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .run(employeeId, eventType, JSON.stringify({ value: previousValue }), JSON.stringify({ value: newValue }),
            text(body.changeReason, 500), userId);
      }
      if (existing.status !== status && (status === "inactive" || existing.status === "inactive")) {
        const eventType = status === "inactive" ? "termination" : "reactivation";
        db.prepare(`INSERT INTO hr_employee_history
          (employee_id, event_type, previous_data_json, new_data_json, reason, changed_by)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .run(employeeId, eventType, JSON.stringify({ status: existing.status }), JSON.stringify({ status }),
            text(body.changeReason, 500), userId);
      }
      return { id: employeeId, folio: existing.employee_number, fullName };
    });
  } catch (error) {
    constraint(error, "El correo electrónico ya está asignado a otro trabajador.");
  }
}

export function personAction(db, id, body, userId = null) {
  const employeeId = positiveId(id, "empleado");
  const employee = db.prepare("SELECT id, employee_number, full_name, status FROM employees WHERE id = ?").get(employeeId);
  if (!employee) throw new HrError(404, "Trabajador no encontrado.");
  if (body.action !== "deactivate") throw new HrError(400, "La acción solicitada no es válida.");
  if (employee.status === "inactive") throw new HrError(409, "El trabajador ya está dado de baja.");
  const terminationDate = optionalDate(body.terminationDate) || today();
  const reason = requiredText(body.reason, 500, "El motivo de baja");
  transaction(db, () => {
    db.prepare("UPDATE employees SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(employeeId);
    db.prepare(`INSERT INTO hr_employee_labor_data
      (employee_id, termination_date, termination_reason)
      VALUES (?, ?, ?)
      ON CONFLICT(employee_id) DO UPDATE SET termination_date = excluded.termination_date,
        termination_reason = excluded.termination_reason, updated_at = CURRENT_TIMESTAMP`)
      .run(employeeId, terminationDate, reason);
    db.prepare(`INSERT INTO hr_employee_history
      (employee_id, event_type, previous_data_json, new_data_json, reason, changed_by)
      VALUES (?, 'termination', ?, ?, ?, ?)`)
      .run(employeeId, JSON.stringify({ status: employee.status }),
        JSON.stringify({ status: "inactive", terminationDate }), reason, userId);
  });
  return { id: employeeId, folio: employee.employee_number, fullName: employee.full_name, status: "inactive" };
}

export function createJobPosition(db, body) {
  const name = requiredText(body.name, 120, "El nombre del puesto");
  const profile = jobPositionProfile(body);
  try {
    const result = db.prepare(`INSERT INTO hr_job_positions
      (code, name, description, profile_education, profile_experience, profile_knowledge,
       profile_skills, profile_competencies)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(placeholder("PUE"), name, text(body.description, 4000), ...profile);
    const id = Number(result.lastInsertRowid), folio = `PUE-${String(id).padStart(5, "0")}`;
    db.prepare("UPDATE hr_job_positions SET code = ? WHERE id = ?").run(folio, id);
    return { id, folio, name };
  } catch (error) {
    constraint(error, "Ya existe un puesto con ese nombre.");
  }
}

export function updateJobPosition(db, id, body) {
  const recordId = positiveId(id, "puesto");
  const current = db.prepare(`SELECT id, code, description, profile_education, profile_experience,
    profile_knowledge, profile_skills, profile_competencies
    FROM hr_job_positions WHERE id = ? AND is_active = 1`).get(recordId);
  if (!current) throw new HrError(404, "Puesto no encontrado.");
  const name = requiredText(body.name, 120, "El nombre del puesto");
  const profile = jobPositionProfile(body, current);
  try {
    db.prepare(`UPDATE hr_job_positions SET name = ?, description = ?,
      profile_education = ?, profile_experience = ?, profile_knowledge = ?,
      profile_skills = ?, profile_competencies = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(name, Object.hasOwn(body, "description") ? text(body.description, 4000) : current.description,
        ...profile, recordId);
    return { id: recordId, folio: current.code, name };
  } catch (error) {
    constraint(error, "Ya existe un puesto con ese nombre.");
  }
}

function jobPositionProfile(body, current = {}) {
  return [
    ["profileEducation", "profile_education"],
    ["profileExperience", "profile_experience"],
    ["profileKnowledge", "profile_knowledge"],
    ["profileSkills", "profile_skills"],
    ["profileCompetencies", "profile_competencies"],
  ].map(([input, stored]) => Object.hasOwn(body, input)
    ? text(body[input], 2000)
    : text(current[stored], 2000));
}

export function organizationStructure(db, managedCompanyId = null) {
  const companyFilter = managedCompanyId ? " WHERE id = ?" : "";
  const relationFilter = managedCompanyId ? " WHERE wc.company_id = ?" : "";
  const departmentFilter = managedCompanyId ? " WHERE d.company_id = ?" : "";
  return {
    companies: db.prepare(`SELECT id, code, legal_name, trade_name, tax_id, is_active
      FROM companies${companyFilter} ORDER BY legal_name`).all(...(managedCompanyId ? [managedCompanyId] : [])),
    workCenters: db.prepare(`SELECT wc.id, wc.company_id, wc.code, wc.name, wc.center_type,
      wc.address, wc.timezone, wc.is_active, c.legal_name AS company_name
      FROM hr_work_centers wc JOIN companies c ON c.id = wc.company_id
      ${relationFilter} ORDER BY c.legal_name, wc.name`).all(...(managedCompanyId ? [managedCompanyId] : [])),
    departments: db.prepare(`SELECT d.id, d.company_id, d.work_center_id, d.parent_department_id,
      d.area_id, d.code, d.name, d.is_active, c.legal_name AS company_name,
      wc.name AS work_center_name, p.name AS parent_department_name, a.name AS area_name
      FROM hr_departments d JOIN companies c ON c.id = d.company_id
      LEFT JOIN hr_work_centers wc ON wc.id = d.work_center_id
      LEFT JOIN hr_departments p ON p.id = d.parent_department_id
      LEFT JOIN areas a ON a.id = d.area_id
      ${departmentFilter} ORDER BY c.legal_name, d.name`).all(...(managedCompanyId ? [managedCompanyId] : [])),
    areas: db.prepare("SELECT id, code, name FROM areas WHERE is_active = 1 ORDER BY name").all(),
  };
}

export function createCompany(db, body) {
  const legalName = requiredText(body.legalName, 180, "La razón social");
  try {
    const result = db.prepare(`INSERT INTO companies
      (code, legal_name, trade_name, tax_id) VALUES (?, ?, ?, ?)`)
      .run(placeholder("EMP"), legalName, text(body.tradeName, 180), text(body.taxId, 30).toUpperCase());
    const id = Number(result.lastInsertRowid), folio = `EMP-${String(id).padStart(5, "0")}`;
    db.prepare("UPDATE companies SET code = ? WHERE id = ?").run(folio, id);
    return { id, folio, name: legalName };
  } catch (error) {
    constraint(error, "Ya existe una empresa con esos datos.");
  }
}

export function updateCompany(db, id, body) {
  const recordId = positiveId(id, "empresa");
  const current = db.prepare("SELECT id, code FROM companies WHERE id = ?").get(recordId);
  if (!current) throw new HrError(404, "Empresa no encontrada.");
  const legalName = requiredText(body.legalName, 180, "La razón social");
  try {
    db.prepare(`UPDATE companies SET legal_name = ?, trade_name = ?, tax_id = ?, is_active = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(legalName, text(body.tradeName, 180), text(body.taxId, 30).toUpperCase(),
        body.isActive === false || body.isActive === "false" ? 0 : 1, recordId);
    return { id: recordId, folio: current.code, name: legalName };
  } catch (error) {
    constraint(error, "Ya existe una empresa con esos datos.");
  }
}

export function createWorkCenter(db, body) {
  const companyId = positiveId(body.companyId, "empresa");
  requireRecord(db, "companies", companyId, "Empresa");
  const name = requiredText(body.name, 180, "El nombre del centro");
  const centerType = enumRequired(body.centerType || "work_center",
    ["plant", "branch", "work_center", "office", "other"], "tipo de centro");
  const timezone = text(body.timezone, 80) || configuredTimezone(db);
  try {
    const result = db.prepare(`INSERT INTO hr_work_centers
      (company_id, code, name, center_type, address, timezone) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(companyId, placeholder("CTR"), name, centerType, text(body.address, 500), timezone);
    const id = Number(result.lastInsertRowid), folio = `CTR-${String(id).padStart(5, "0")}`;
    db.prepare("UPDATE hr_work_centers SET code = ? WHERE id = ?").run(folio, id);
    return { id, folio, name };
  } catch (error) {
    constraint(error, "Ya existe ese centro de trabajo para la empresa.");
  }
}

export function updateWorkCenter(db, id, body) {
  const recordId = positiveId(id, "centro de trabajo");
  const current = db.prepare("SELECT id, code, timezone FROM hr_work_centers WHERE id = ?").get(recordId);
  if (!current) throw new HrError(404, "Centro de trabajo no encontrado.");
  const companyId = positiveId(body.companyId, "empresa");
  requireRecord(db, "companies", companyId, "Empresa");
  const name = requiredText(body.name, 180, "El nombre del centro");
  const centerType = enumRequired(body.centerType || "work_center",
    ["plant", "branch", "work_center", "office", "other"], "tipo de centro");
  const timezone = Object.hasOwn(body, "timezone")
    ? text(body.timezone, 80) || configuredTimezone(db)
    : current.timezone || configuredTimezone(db);
  try {
    db.prepare(`UPDATE hr_work_centers SET company_id = ?, name = ?, center_type = ?, address = ?,
      timezone = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(companyId, name, centerType, text(body.address, 500), timezone,
        body.isActive === false || body.isActive === "false" ? 0 : 1, recordId);
    return { id: recordId, folio: current.code, name };
  } catch (error) {
    constraint(error, "Ya existe ese centro de trabajo para la empresa.");
  }
}

function configuredTimezone(db) {
  return text(db.prepare("SELECT value FROM app_settings WHERE key = 'timezone'").get()?.value, 80)
    || "America/Chicago";
}

export function createDepartment(db, body) {
  const values = departmentValues(db, body);
  try {
    const result = db.prepare(`INSERT INTO hr_departments
      (company_id, work_center_id, parent_department_id, area_id, code, name)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(values.companyId, values.workCenterId, values.parentDepartmentId, values.areaId,
        placeholder("DEP"), values.name);
    const id = Number(result.lastInsertRowid), folio = `DEP-${String(id).padStart(5, "0")}`;
    db.prepare("UPDATE hr_departments SET code = ? WHERE id = ?").run(folio, id);
    return { id, folio, name: values.name };
  } catch (error) {
    constraint(error, "Ya existe ese departamento para la empresa.");
  }
}

export function updateDepartment(db, id, body) {
  const recordId = positiveId(id, "departamento");
  const current = db.prepare("SELECT id, code FROM hr_departments WHERE id = ?").get(recordId);
  if (!current) throw new HrError(404, "Departamento no encontrado.");
  const values = departmentValues(db, body, recordId);
  try {
    db.prepare(`UPDATE hr_departments SET company_id = ?, work_center_id = ?, parent_department_id = ?,
      area_id = ?, name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(values.companyId, values.workCenterId, values.parentDepartmentId, values.areaId, values.name,
        body.isActive === false || body.isActive === "false" ? 0 : 1, recordId);
    return { id: recordId, folio: current.code, name: values.name };
  } catch (error) {
    constraint(error, "Ya existe ese departamento para la empresa.");
  }
}

function departmentValues(db, body, currentId = null) {
  const companyId = positiveId(body.companyId, "empresa");
  requireRecord(db, "companies", companyId, "Empresa");
  const workCenterId = optionalExistingId(db, "hr_work_centers", body.workCenterId, "centro de trabajo");
  const parentDepartmentId = optionalExistingId(db, "hr_departments", body.parentDepartmentId, "departamento superior");
  const areaId = optionalExistingId(db, "areas", body.areaId, "área");
  if (currentId && Number(parentDepartmentId) === Number(currentId))
    throw new HrError(400, "Un departamento no puede depender de sí mismo.");
  if (workCenterId) {
    const center = db.prepare("SELECT company_id FROM hr_work_centers WHERE id = ?").get(workCenterId);
    if (Number(center.company_id) !== companyId) throw new HrError(400, "El centro pertenece a otra empresa.");
  }
  if (parentDepartmentId) {
    const parent = db.prepare("SELECT company_id FROM hr_departments WHERE id = ?").get(parentDepartmentId);
    if (Number(parent.company_id) !== companyId) throw new HrError(400, "El departamento superior pertenece a otra empresa.");
  }
  return { companyId, workCenterId, parentDepartmentId, areaId,
    name: requiredText(body.name, 180, "El nombre del departamento") };
}

export function createWorkShift(db, body) {
  const name = requiredText(body.name, 120, "El nombre del turno");
  const schedule = weeklySchedule(body);
  const firstPeriod = schedule[0].periods[0];
  const lastPeriod = schedule[0].periods.at(-1);
  const workDays = [...new Set(schedule.flatMap((group) => group.days))];
  const breakMinutes = schedule[0].periods.length > 1
    ? minutesBetween(firstPeriod.end, schedule[0].periods[1].start)
    : integerBetween(body.breakMinutes || 0, 0, 480, "Los minutos de descanso");
  try {
    const result = db.prepare(`INSERT INTO hr_work_shifts
      (code, name, start_time, end_time, work_days, break_minutes, schedule_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(placeholder("TUR"), name, firstPeriod.start, lastPeriod.end, workDays.join(","), breakMinutes, JSON.stringify(schedule));
    const id = Number(result.lastInsertRowid), folio = `TUR-${String(id).padStart(5, "0")}`;
    db.prepare("UPDATE hr_work_shifts SET code = ? WHERE id = ?").run(folio, id);
    return { id, folio, name };
  } catch (error) {
    constraint(error, "Ya existe un turno con ese nombre.");
  }
}

export function updateWorkShift(db, id, body) {
  const recordId = positiveId(id, "turno");
  const current = db.prepare("SELECT id, code FROM hr_work_shifts WHERE id = ? AND is_active = 1").get(recordId);
  if (!current) throw new HrError(404, "Turno no encontrado.");
  const name = requiredText(body.name, 120, "El nombre del turno");
  const schedule = weeklySchedule(body);
  const firstPeriod = schedule[0].periods[0];
  const lastPeriod = schedule[0].periods.at(-1);
  const workDays = [...new Set(schedule.flatMap((group) => group.days))];
  const breakMinutes = schedule[0].periods.length > 1
    ? minutesBetween(firstPeriod.end, schedule[0].periods[1].start)
    : integerBetween(body.breakMinutes || 0, 0, 480, "Los minutos de descanso");
  try {
    db.prepare(`UPDATE hr_work_shifts SET name = ?, start_time = ?, end_time = ?, work_days = ?,
      break_minutes = ?, schedule_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(name, firstPeriod.start, lastPeriod.end, workDays.join(","), breakMinutes,
        JSON.stringify(schedule), recordId);
    return { id: recordId, folio: current.code, name };
  } catch (error) {
    constraint(error, "Ya existe un turno con ese nombre.");
  }
}

export function createVacationPlan(db, body) {
  const name = requiredText(body.name, 120, "El nombre del plan");
  const annualDays = positiveNumber(body.annualDays, "Los días anuales");
  const minServiceYears = integerBetween(body.minServiceYears || 1, 1, 100, "La antigüedad mínima");
  const maxServiceYears = body.maxServiceYears === "" || body.maxServiceYears == null
    ? null
    : integerBetween(body.maxServiceYears, minServiceYears, 100, "La antigüedad máxima");
  try {
    const result = db.prepare(`INSERT INTO hr_vacation_plans
      (code, name, annual_days, min_service_years, max_service_years, description) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(placeholder("PLV"), name, annualDays, minServiceYears, maxServiceYears, text(body.description, 500));
    const id = Number(result.lastInsertRowid), folio = `PLV-${String(id).padStart(5, "0")}`;
    db.prepare("UPDATE hr_vacation_plans SET code = ? WHERE id = ?").run(folio, id);
    return { id, folio, name };
  } catch (error) {
    constraint(error, "Ya existe un plan de vacaciones con ese nombre.");
  }
}

export function updateVacationPlan(db, id, body) {
  const recordId = positiveId(id, "plan de vacaciones");
  const current = db.prepare("SELECT id, code FROM hr_vacation_plans WHERE id = ? AND is_active = 1").get(recordId);
  if (!current) throw new HrError(404, "Plan de vacaciones no encontrado.");
  const name = requiredText(body.name, 120, "El nombre del plan");
  const annualDays = positiveNumber(body.annualDays, "Los días anuales");
  const minServiceYears = integerBetween(body.minServiceYears || 1, 1, 100, "La antigüedad mínima");
  const maxServiceYears = body.maxServiceYears === "" || body.maxServiceYears == null
    ? null
    : integerBetween(body.maxServiceYears, minServiceYears, 100, "La antigüedad máxima");
  try {
    db.prepare(`UPDATE hr_vacation_plans SET name = ?, annual_days = ?, min_service_years = ?,
      max_service_years = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(name, annualDays, minServiceYears, maxServiceYears, text(body.description, 500), recordId);
    syncVacationPlans(db);
    return { id: recordId, folio: current.code, name };
  } catch (error) {
    constraint(error, "Ya existe un plan de vacaciones con ese nombre.");
  }
}

export function syncVacationPlans(db) {
  const people = db.prepare(`SELECT e.id, e.hire_date, p.employment_type, p.vacation_plan_id,
    p.vacation_balance, p.vacation_debt, p.vacation_cycle_year, p.vacation_renewed_at
    FROM employees e JOIN hr_employee_profiles p ON p.employee_id = e.id`).all();
  const plans = db.prepare(`SELECT * FROM hr_vacation_plans WHERE is_active = 1
    ORDER BY min_service_years DESC,
      CASE WHEN max_service_years IS NULL THEN 1 ELSE 0 END,
      id DESC`).all();
  const update = db.prepare(`UPDATE hr_employee_profiles
    SET vacation_plan_id = ?, vacation_balance = ?, vacation_debt = ?,
      vacation_cycle_year = ?, vacation_renewed_at = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE employee_id = ?`);
  for (const person of people) {
    if (person.employment_type !== "permanent") {
      if (person.vacation_plan_id || person.vacation_balance || person.vacation_debt || person.vacation_cycle_year)
        update.run(null, 0, 0, 0, null, person.id);
      continue;
    }
    const years = serviceYears(person.hire_date);
    const plan = automaticVacationPlanFromList(plans, person.hire_date);
    const previousCycle = Number(person.vacation_cycle_year || 0);
    let balance = Number(person.vacation_balance || 0);
    let debt = Number(person.vacation_debt || 0);
    let cycle = previousCycle;
    let renewedAt = person.vacation_renewed_at || null;
    if (!plan) {
      balance = 0;
      cycle = 0;
    } else if (years > previousCycle) {
      const renewedNet = Number(plan.annual_days || 0) - debt;
      balance = Math.max(0, renewedNet);
      debt = Math.max(0, -renewedNet);
      cycle = years;
      renewedAt = today();
    }
    if (Number(person.vacation_plan_id || 0) !== Number(plan?.id || 0)
      || Number(person.vacation_balance || 0) !== balance
      || Number(person.vacation_debt || 0) !== debt
      || previousCycle !== cycle
      || String(person.vacation_renewed_at || "") !== String(renewedAt || "")) {
      update.run(plan?.id || null, balance, debt, cycle, renewedAt, person.id);
    }
  }
}

function vacationBalanceProjection(employee, requestedDays) {
  const balance = Number(employee.vacation_balance || 0);
  const debtBefore = Number(employee.vacation_debt || 0);
  const availableBefore = Math.max(0, balance - debtBefore);
  const requested = Math.max(0, Number(requestedDays || 0));
  const advanceDays = Math.max(0, requested - availableBefore);
  return {
    availableBefore,
    requestedDays: requested,
    availableAfter: Math.max(0, availableBefore - requested),
    advanceDays,
    debtBefore,
    debtAfter: debtBefore + advanceDays,
  };
}

export function previewLeave(db, body) {
  const employeeId = positiveId(body.employeeId, "empleado");
  const employee = db.prepare(`SELECT e.id, e.department_id, e.status, e.employee_number, e.full_name,
    p.employment_type, p.vacation_balance, p.vacation_debt
    FROM employees e LEFT JOIN hr_employee_profiles p ON p.employee_id = e.id WHERE e.id = ?`).get(employeeId);
  if (!employee) throw new HrError(404, "Empleado no encontrado.");
  const leaveType = enumRequired(body.leaveType, ["permission", "vacation", "incapacity"], "tipo de ausencia");
  if (leaveType === "vacation" && employee.employment_type !== "permanent")
    throw new HrError(409, "Las vacaciones solo aplican al personal permanente.");
  const startDate = requiredDate(body.startDate), endDate = requiredDate(body.endDate || body.startDate);
  if (endDate < startDate) throw new HrError(400, "La fecha final no puede ser anterior a la inicial.");
  const settings = db.prepare("SELECT * FROM hr_portal_settings WHERE id = 1").get();
  const workingDays = leaveWorkingDays(db, startDate, endDate, settings);
  const balance = leaveType === "vacation" ? vacationBalanceProjection(employee, workingDays) : null;
  const overlap = db.prepare(`SELECT id, folio, leave_type, start_date, end_date FROM hr_leave_requests
    WHERE employee_id = ? AND status IN ('submitted', 'approved') AND start_date <= ? AND end_date >= ?
    ORDER BY start_date LIMIT 1`).get(employeeId, endDate, startDate) || null;
  return {
    employeeId,
    employeeNumber: employee.employee_number,
    employeeName: employee.full_name,
    leaveType,
    startDate,
    endDate,
    calendarDays: daysBetween(startDate, endDate) + 1,
    workingDays,
    balance,
    overlap,
    coverage: measureLeaveCoverage(db, employee.department_id, employeeId, startDate, endDate, settings),
  };
}

export function createLeave(db, body, userId) {
  const employeeId = positiveId(body.employeeId, "empleado");
  const employee = db.prepare(`SELECT e.id, e.department_id, e.status, p.manager_employee_id,
    p.employment_type, p.vacation_balance, p.vacation_debt
    FROM employees e LEFT JOIN hr_employee_profiles p ON p.employee_id = e.id WHERE e.id = ?`).get(employeeId);
  if (!employee) throw new HrError(404, "Empleado no encontrado.");
  const leaveType = enumRequired(body.leaveType, ["permission", "vacation", "incapacity"], "tipo de ausencia");
  if (leaveType === "vacation") {
    if (employee.employment_type !== "permanent") {
      throw new HrError(409, "Las vacaciones solo aplican al personal permanente.");
    }
  }
  const startDate = requiredDate(body.startDate), endDate = requiredDate(body.endDate || body.startDate);
  if (endDate < startDate) throw new HrError(400, "La fecha final no puede ser anterior a la inicial.");
  const settings = db.prepare("SELECT * FROM hr_portal_settings WHERE id = 1").get();
  const workingDays = leaveWorkingDays(db, startDate, endDate, settings);
  const totalDays = body.totalDays === "" || body.totalDays == null ? workingDays : nonNegative(body.totalDays, "Los días");
  const totalHours = leaveType === "vacation" ? 0 : nonNegative(body.totalHours || 0, "Las horas");
  if (userId == null && leaveType !== "incapacity" && daysBetween(today(), startDate) < Number(settings.minimum_advance_days || 0))
    throw new HrError(409, `La solicitud requiere al menos ${settings.minimum_advance_days} días de anticipación.`);
  const overlap = db.prepare(`SELECT folio, leave_type, start_date, end_date FROM hr_leave_requests
    WHERE employee_id = ? AND status IN ('submitted', 'approved') AND start_date <= ? AND end_date >= ? LIMIT 1`)
    .get(employeeId, endDate, startDate);
  if (overlap) throw new HrError(409, `Las fechas coinciden con ${overlap.folio}.`);
  if (!totalDays && !totalHours) throw new HrError(400, "La solicitud debe incluir al menos un día u horas.");
  const isUnpaid = leaveType === "permission" ? flagValue(body.isUnpaid) : 0;
  const unpaidAccepted = flagValue(body.unpaidTermsAccepted);
  if (isUnpaid && !unpaidAccepted) throw new HrError(400, "Debes aceptar que el permiso sin goce se enviará a prenómina.");
  const coverageEmployeeId = optionalExistingId(db, "employees", body.coverageEmployeeId, "persona de cobertura");
  if (coverageEmployeeId) validateCoverageEmployee(db, employee, coverageEmployeeId, startDate, endDate);
  const balanceProjection = leaveType === "vacation" ? vacationBalanceProjection(employee, totalDays) : null;
  const vacationAdvance = balanceProjection?.advanceDays > 0 ? 1 : 0;
  const requiresManager = userId == null && Boolean(settings.manager_approval_required) && Boolean(employee.manager_employee_id);
  const coverage = measureLeaveCoverage(db, employee.department_id, employeeId, startDate, endDate, settings);
  const prefix = { permission: "PER-", vacation: "VAC-", incapacity: "INA-" }[leaveType];
  return transaction(db, () => {
    const result = db.prepare(`INSERT INTO hr_leave_requests
      (folio, employee_id, leave_type, subtype, start_date, end_date, total_days, total_hours, reason,
       certificate_number, medical_provider, created_by, vacation_advance, current_approval_step,
       coverage_employee_id, is_unpaid, unpaid_terms_accepted, working_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(placeholder("AUS"), employeeId, leaveType, text(body.subtype, 100), startDate, endDate, totalDays,
        totalHours, requiredText(body.reason, 800, "El motivo"),
        text(body.certificateNumber, 120), text(body.medicalProvider, 180), userId, vacationAdvance,
        requiresManager ? "manager" : "hr", coverageEmployeeId, isUnpaid, unpaidAccepted, workingDays);
    const id = Number(result.lastInsertRowid), folio = prefix + String(id).padStart(6, "0");
    db.prepare("UPDATE hr_leave_requests SET folio = ? WHERE id = ?").run(folio, id);
    db.prepare(`INSERT INTO hr_leave_workflow_steps
      (leave_request_id, step_order, step_type, status, assigned_employee_id)
      VALUES (?, 1, 'manager', ?, ?)`)
      .run(id, requiresManager ? "pending" : "skipped", employee.manager_employee_id || null);
    db.prepare(`INSERT INTO hr_leave_workflow_steps
      (leave_request_id, step_order, step_type, status) VALUES (?, 2, 'hr', ?)`)
      .run(id, requiresManager ? "blocked" : "pending");
    addLeaveHistory(db, id, null, "submitted", "created", userId == null ? "employee" : "hr",
      userId == null ? employeeId : null, userId, body.comments || "Solicitud registrada");
    if (body.comments) addLeaveComment(db, id, body.comments, userId == null ? employeeId : null, userId, "comment");
    if (balanceProjection) db.prepare(`INSERT INTO hr_leave_balance_snapshots
      (leave_request_id, employee_id, available_before, requested_days, available_after,
       advance_days, debt_before, debt_after)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, employeeId, balanceProjection.availableBefore, balanceProjection.requestedDays,
        balanceProjection.availableAfter, balanceProjection.advanceDays,
        balanceProjection.debtBefore, balanceProjection.debtAfter);
    return { id, folio, currentStep: requiresManager ? "manager" : "hr", workingDays,
      vacationAdvance: Boolean(vacationAdvance), balance: balanceProjection, coverage };
  });
}

export function leaveReceipt(db, id) {
  const requestId = positiveId(id, "solicitud");
  const request = db.prepare(`SELECT l.*, e.employee_number, e.full_name AS employee_name,
    COALESCE(jp.name, e.position, '') AS position_name, a.name AS area_name,
    c.legal_name AS company_name, wc.name AS work_center_name, d.name AS department_name,
    creator.full_name AS created_by_name, approver.full_name AS approved_by_name
    FROM hr_leave_requests l
    JOIN employees e ON e.id = l.employee_id
    LEFT JOIN hr_job_positions jp ON jp.id = e.position_id
    LEFT JOIN areas a ON a.id = e.area_id
    LEFT JOIN companies c ON c.id = e.company_id
    LEFT JOIN hr_work_centers wc ON wc.id = e.work_center_id
    LEFT JOIN hr_departments d ON d.id = e.department_id
    LEFT JOIN users creator ON creator.id = l.created_by
    LEFT JOIN users approver ON approver.id = l.approved_by
    WHERE l.id = ?`).get(requestId);
  if (!request) throw new HrError(404, "Solicitud no encontrada.");
  let balance = db.prepare("SELECT * FROM hr_leave_balance_snapshots WHERE leave_request_id = ?").get(requestId) || null;
  if (!balance && request.leave_type === "vacation") {
    const movement = db.prepare(`SELECT * FROM hr_vacation_balance_movements
      WHERE leave_request_id = ? AND movement_type IN ('consumption', 'advance') ORDER BY id DESC LIMIT 1`).get(requestId);
    if (movement) balance = {
      available_before: Math.max(0, Number(movement.balance_before || 0) - Number(movement.debt_before || 0)),
      requested_days: Number(movement.days || request.working_days || request.total_days || 0),
      available_after: Math.max(0, Number(movement.balance_after || 0) - Number(movement.debt_after || 0)),
      advance_days: Math.max(0, Number(movement.debt_after || 0) - Number(movement.debt_before || 0)),
      debt_before: Number(movement.debt_before || 0), debt_after: Number(movement.debt_after || 0),
    };
    else {
      const profile = db.prepare("SELECT vacation_balance, vacation_debt FROM hr_employee_profiles WHERE employee_id = ?").get(request.employee_id) || {};
      const fallback = vacationBalanceProjection(profile, request.working_days || request.total_days || 0);
      balance = {
        available_before: fallback.availableBefore, requested_days: fallback.requestedDays,
        available_after: fallback.availableAfter, advance_days: fallback.advanceDays,
        debt_before: fallback.debtBefore, debt_after: fallback.debtAfter,
      };
    }
  }
  const history = db.prepare(`SELECT h.*, COALESCE(u.full_name, e.full_name, h.actor_type) AS actor_name
    FROM hr_leave_status_history h
    LEFT JOIN users u ON u.id = h.actor_user_id
    LEFT JOIN employees e ON e.id = h.actor_employee_id
    WHERE h.leave_request_id = ? ORDER BY h.created_at, h.id`).all(requestId);
  const printSummary = db.prepare(`SELECT COUNT(*) AS print_count, MAX(printed_at) AS last_printed_at
    FROM hr_leave_print_log WHERE leave_request_id = ?`).get(requestId);
  return { request, balance, history, printCount: Number(printSummary?.print_count || 0),
    lastPrintedAt: printSummary?.last_printed_at || null };
}

export function recordLeavePrint(db, id, userId, ipAddress = "") {
  const receipt = leaveReceipt(db, id);
  db.prepare(`INSERT INTO hr_leave_print_log (leave_request_id, user_id, ip_address) VALUES (?, ?, ?)`)
    .run(receipt.request.id, userId, text(ipAddress, 120));
  return leaveReceipt(db, id);
}

export function updatePortalLeave(db, id, employeeId, body) {
  const requestId = positiveId(id, "solicitud");
  const ownerId = positiveId(employeeId, "empleado");
  const row = db.prepare("SELECT * FROM hr_leave_requests WHERE id = ? AND employee_id = ?").get(requestId, ownerId);
  if (!row) throw new HrError(404, "Solicitud no encontrada.");
  if (row.status !== "submitted") throw new HrError(409, "La solicitud ya no puede modificarse.");
  const latestReview = db.prepare(`SELECT action FROM hr_leave_request_reviews
    WHERE leave_request_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`).get(requestId);
  if (latestReview?.action !== "request_changes")
    throw new HrError(409, "Esta solicitud no tiene modificaciones pendientes.");
  const startDate = requiredDate(body.startDate ?? row.start_date);
  const endDate = requiredDate(body.endDate ?? body.startDate ?? row.end_date);
  if (endDate < startDate) throw new HrError(400, "La fecha final no puede ser anterior a la inicial.");
  const overlap = db.prepare(`SELECT folio FROM hr_leave_requests WHERE employee_id = ? AND id <> ?
    AND status IN ('submitted', 'approved') AND start_date <= ? AND end_date >= ? LIMIT 1`)
    .get(ownerId, requestId, endDate, startDate);
  if (overlap) throw new HrError(409, `Las fechas coinciden con ${overlap.folio}.`);
  const settings = db.prepare("SELECT * FROM hr_portal_settings WHERE id = 1").get();
  const workingDays = leaveWorkingDays(db, startDate, endDate, settings);
  const totalDays = body.totalDays === "" || body.totalDays == null
    ? workingDays : nonNegative(body.totalDays, "Los días");
  const reason = requiredText(body.reason ?? row.reason, 800, "El motivo");
  const subtype = Object.hasOwn(body, "subtype") ? text(body.subtype, 100) : row.subtype;
  const totalHours = row.leave_type === "vacation" ? 0 : Object.hasOwn(body, "totalHours")
    ? nonNegative(body.totalHours || 0, "Las horas") : row.total_hours;
  db.prepare(`UPDATE hr_leave_requests SET subtype = ?, start_date = ?, end_date = ?, total_days = ?,
    total_hours = ?, reason = ?, working_days = ?, proposed_start_date = NULL, proposed_end_date = NULL,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(subtype, startDate, endDate, totalDays, totalHours, reason, workingDays, requestId);
  addLeaveHistory(db, requestId, "submitted", "submitted", "resubmitted", "employee", ownerId, null,
    "Solicitud corregida y reenviada.");
  return { id: requestId, folio: row.folio, status: row.status };
}

export function leaveAction(db, id, body, userId) {
  const row = db.prepare("SELECT * FROM hr_leave_requests WHERE id = ?").get(id);
  if (!row) throw new HrError(404, "Solicitud no encontrada.");
  const action = body.action;
  const transitions = {
    approve: [["submitted"], "approved"],
    reject: [["submitted"], "rejected"],
    cancel: [["submitted", "approved"], "cancelled"],
    close: [["approved"], "closed"],
  };
  if (!transitions[action] || !transitions[action][0].includes(row.status)) throw new HrError(409, "La solicitud no admite esa acción.");
  const managerOverride = ["approve", "reject"].includes(action)
    && row.current_approval_step === "manager" && body.administrativeOverride === true;
  if (["approve", "reject"].includes(action) && row.current_approval_step === "manager" && !managerOverride)
    throw new HrError(409, "La solicitud requiere primero la autorización del Jefe de área.");
  const reason = text(body.reason, 800);
  if (action === "reject" && reason.length < 5) throw new HrError(400, "Captura el motivo del rechazo.");
  const status = transitions[action][1];
  transaction(db, () => {
    if (managerOverride) db.prepare(`UPDATE hr_leave_workflow_steps SET status = ?, decided_by_user_id = ?,
      decision_reason = ?, decided_at = CURRENT_TIMESTAMP WHERE leave_request_id = ? AND step_type = 'manager'`)
      .run(status, userId, reason || "Resuelta directamente por Administrador RH.", id);
    db.prepare(`UPDATE hr_leave_requests SET status = ?, current_approval_step = CASE WHEN ? IN ('approved','rejected') THEN 'completed' ELSE current_approval_step END,
      rejection_reason = CASE WHEN ? = 'rejected' THEN ? ELSE rejection_reason END,
      approved_by = CASE WHEN ? IN ('approved','rejected') THEN ? ELSE approved_by END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(status, status, status, reason, status, userId, id);
    if (["approve", "reject"].includes(action)) db.prepare(`UPDATE hr_leave_workflow_steps SET status = ?, decided_by_user_id = ?,
      decision_reason = ?, decided_at = CURRENT_TIMESTAMP WHERE leave_request_id = ? AND step_type = 'hr'`)
      .run(status, userId, reason, id);
    if (status === "approved") applyApprovedLeave(db, row, userId);
    if (status === "cancelled") restoreCancelledVacation(db, row, userId);
    addLeaveHistory(db, id, row.status, status, action, "hr", null, userId, reason,
      body.proposedStartDate, body.proposedEndDate);
    if (reason) addLeaveComment(db, id, reason, null, userId, "decision");
  });
  if (status === "approved" && row.start_date <= today() && row.end_date >= today())
    db.prepare("UPDATE employees SET status = 'leave', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.employee_id);
  if (["closed", "cancelled"].includes(status))
    db.prepare("UPDATE employees SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'leave'").run(row.employee_id);
  return { id, folio: row.folio, status, administrativeOverride: managerOverride };
}

export function managerLeaveAction(db, id, managerEmployeeId, body) {
  const row = db.prepare(`SELECT l.* FROM hr_leave_requests l JOIN hr_employee_profiles p ON p.employee_id = l.employee_id
    WHERE l.id = ? AND p.manager_employee_id = ?`).get(positiveId(id, "solicitud"), positiveId(managerEmployeeId, "jefe"));
  if (!row) throw new HrError(404, "La solicitud no pertenece a tu plantilla.");
  if (row.status !== "submitted" || row.current_approval_step !== "manager")
    throw new HrError(409, "La solicitud no está pendiente de tu autorización.");
  const action = enumRequired(body.action, ["approve", "reject", "request_changes"], "acción");
  const reason = requiredText(body.reason, 800, "El motivo");
  if (reason.length < 5) throw new HrError(400, "Captura un motivo de al menos 5 caracteres.");
  const proposedStartDate = body.proposedStartDate ? requiredDate(body.proposedStartDate) : null;
  const proposedEndDate = body.proposedEndDate ? requiredDate(body.proposedEndDate) : null;
  return transaction(db, () => {
    if (action === "approve") {
      db.prepare(`UPDATE hr_leave_workflow_steps SET status = 'approved', decided_by_employee_id = ?,
        decision_reason = ?, decided_at = CURRENT_TIMESTAMP WHERE leave_request_id = ? AND step_type = 'manager'`).run(managerEmployeeId, reason, id);
      db.prepare("UPDATE hr_leave_workflow_steps SET status = 'pending' WHERE leave_request_id = ? AND step_type = 'hr'").run(id);
      db.prepare("UPDATE hr_leave_requests SET current_approval_step = 'hr', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      addLeaveHistory(db, id, "submitted", "submitted", "manager_approved", "manager", managerEmployeeId, null, reason);
    } else if (action === "reject") {
      db.prepare(`UPDATE hr_leave_workflow_steps SET status = 'rejected', decided_by_employee_id = ?,
        decision_reason = ?, proposed_start_date = ?, proposed_end_date = ?, decided_at = CURRENT_TIMESTAMP
        WHERE leave_request_id = ? AND step_type = 'manager'`).run(managerEmployeeId, reason, proposedStartDate, proposedEndDate, id);
      db.prepare(`UPDATE hr_leave_requests SET status = 'rejected', current_approval_step = 'completed', rejection_reason = ?,
        proposed_start_date = ?, proposed_end_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(reason, proposedStartDate, proposedEndDate, id);
      addLeaveHistory(db, id, "submitted", "rejected", "manager_rejected", "manager", managerEmployeeId, null,
        reason, proposedStartDate, proposedEndDate);
    } else {
      db.prepare(`UPDATE hr_leave_requests SET proposed_start_date = ?, proposed_end_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(proposedStartDate, proposedEndDate, id);
      addLeaveHistory(db, id, "submitted", "submitted", "changes_requested", "manager", managerEmployeeId, null,
        reason, proposedStartDate, proposedEndDate);
    }
    addLeaveComment(db, id, reason, managerEmployeeId, null, "decision");
    return { id, folio: row.folio, status: action === "reject" ? "rejected" : "submitted", currentStep: action === "approve" ? "hr" : "manager" };
  });
}

export function createAttendance(db, body, userId) {
  const employeeId = positiveId(body.employeeId, "empleado");
  requireRecord(db, "employees", employeeId, "Empleado");
  const eventType = enumRequired(body.eventType, ["entry", "exit"], "movimiento");
  const occurredAt = body.occurredAt ? dateTime(body.occurredAt) : new Date().toISOString().replace("T", " ").replace("Z", "");
  const last = db.prepare("SELECT event_type, occurred_at FROM hr_attendance WHERE employee_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1").get(employeeId);
  if (last && last.event_type === eventType && String(last.occurred_at).slice(0, 10) === String(occurredAt).slice(0, 10))
    throw new HrError(409, `La última marcación del día ya es una ${eventType === "entry" ? "entrada" : "salida"}.`);
  const result = db.prepare("INSERT INTO hr_attendance (folio, employee_id, event_type, occurred_at, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)")
    .run(placeholder("ASI"), employeeId, eventType, occurredAt, text(body.notes, 500), userId);
  const id = Number(result.lastInsertRowid), folio = `ASI-${String(id).padStart(6, "0")}`;
  db.prepare("UPDATE hr_attendance SET folio = ? WHERE id = ?").run(folio, id);
  return { id, folio };
}

function leaveWorkingDays(db, startDate, endDate, settings) {
  const holidays = new Set(settings.exclude_holidays
    ? db.prepare("SELECT holiday_date FROM hr_holidays WHERE is_active = 1 AND holiday_date BETWEEN ? AND ?").all(startDate, endDate).map((row) => row.holiday_date)
    : []);
  const cursor = new Date(`${startDate}T00:00:00Z`), limit = new Date(`${endDate}T00:00:00Z`);
  let days = 0;
  while (cursor <= limit) {
    const date = cursor.toISOString().slice(0, 10), weekday = cursor.getUTCDay();
    if ((!settings.exclude_weekends || (weekday !== 0 && weekday !== 6)) && !holidays.has(date)) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function daysBetween(startDate, endDate) {
  return Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000);
}

function validateCoverageEmployee(db, employee, coverageEmployeeId, startDate, endDate) {
  if (Number(employee.id) === Number(coverageEmployeeId)) throw new HrError(400, "La persona de cobertura debe ser otro colaborador.");
  const coverage = db.prepare("SELECT id, department_id, status FROM employees WHERE id = ?").get(coverageEmployeeId);
  if (!coverage || coverage.status === "inactive") throw new HrError(409, "La persona de cobertura no está activa.");
  if (Number(coverage.department_id || 0) !== Number(employee.department_id || 0))
    throw new HrError(409, "La persona de cobertura debe pertenecer al mismo departamento.");
  const overlap = db.prepare(`SELECT folio FROM hr_leave_requests WHERE employee_id = ?
    AND status IN ('submitted', 'approved') AND start_date <= ? AND end_date >= ? LIMIT 1`)
    .get(coverageEmployeeId, endDate, startDate);
  if (overlap) throw new HrError(409, `La persona de cobertura no está disponible por ${overlap.folio}.`);
}

function measureLeaveCoverage(db, departmentId, employeeId, startDate, endDate, settings) {
  if (!departmentId) return { total: 0, absent: 0, availableAfter: 0, withinLimit: true };
  const total = Number(db.prepare("SELECT COUNT(*) AS value FROM employees WHERE department_id = ? AND status <> 'inactive'").get(departmentId).value || 0);
  const absentRows = db.prepare(`SELECT DISTINCT l.employee_id FROM hr_leave_requests l JOIN employees e ON e.id = l.employee_id
    WHERE e.department_id = ? AND l.employee_id <> ? AND l.status IN ('submitted', 'approved')
      AND l.start_date <= ? AND l.end_date >= ?`).all(departmentId, employeeId, endDate, startDate);
  const absent = absentRows.length + 1;
  const availableAfter = Math.max(0, total - absent);
  const limit = db.prepare("SELECT maximum_absent, minimum_available FROM hr_department_absence_limits WHERE department_id = ?").get(departmentId);
  const percentageMinimum = Math.ceil(total * Number(settings.minimum_coverage_percent || 0) / 100);
  const minimumAvailable = Math.max(Number(limit?.minimum_available || 0), percentageMinimum);
  const maximumAbsent = limit ? Number(limit.maximum_absent) : Math.max(0, total - minimumAvailable);
  return { total, absent, availableAfter, minimumAvailable, maximumAbsent,
    withinLimit: absent <= maximumAbsent && availableAfter >= minimumAvailable };
}

function leaveCoverageContext(db, people, leaves, settings) {
  const totals = new Map();
  for (const person of people) {
    if (!person.department_id || person.status === "inactive") continue;
    const departmentId = Number(person.department_id);
    totals.set(departmentId, (totals.get(departmentId) || 0) + 1);
  }
  const absences = new Map();
  for (const leave of leaves) {
    if (!leave.department_id || !["submitted", "approved"].includes(leave.status)) continue;
    const departmentId = Number(leave.department_id);
    if (!absences.has(departmentId)) absences.set(departmentId, []);
    absences.get(departmentId).push(leave);
  }
  const limits = new Map(db.prepare(`SELECT department_id, maximum_absent, minimum_available
    FROM hr_department_absence_limits`).all().map((row) => [Number(row.department_id), row]));
  return { totals, absences, limits, settings };
}

function measureLeaveCoverageFromContext(context, departmentId, employeeId, startDate, endDate) {
  if (!departmentId) return { total: 0, absent: 0, availableAfter: 0, withinLimit: true };
  const departmentKey = Number(departmentId);
  const total = Number(context.totals.get(departmentKey) || 0);
  const absentEmployees = new Set((context.absences.get(departmentKey) || [])
    .filter((leave) => Number(leave.employee_id) !== Number(employeeId)
      && leave.start_date <= endDate && leave.end_date >= startDate)
    .map((leave) => Number(leave.employee_id)));
  const absent = absentEmployees.size + 1;
  const availableAfter = Math.max(0, total - absent);
  const limit = context.limits.get(departmentKey);
  const percentageMinimum = Math.ceil(total * Number(context.settings?.minimum_coverage_percent || 0) / 100);
  const minimumAvailable = Math.max(Number(limit?.minimum_available || 0), percentageMinimum);
  const maximumAbsent = limit ? Number(limit.maximum_absent) : Math.max(0, total - minimumAvailable);
  return { total, absent, availableAfter, minimumAvailable, maximumAbsent,
    withinLimit: absent <= maximumAbsent && availableAfter >= minimumAvailable };
}

function addLeaveHistory(db, requestId, previousStatus, newStatus, action, actorType,
  actorEmployeeId, actorUserId, comments = "", proposedStartDate = null, proposedEndDate = null) {
  db.prepare(`INSERT INTO hr_leave_status_history
    (leave_request_id, previous_status, new_status, action, actor_type, actor_employee_id,
     actor_user_id, comments, proposed_start_date, proposed_end_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(requestId, previousStatus, newStatus, action, actorType, actorEmployeeId, actorUserId,
      text(comments, 800), proposedStartDate || null, proposedEndDate || null);
}

function addLeaveComment(db, requestId, body, employeeId, userId, type = "comment") {
  const clean = text(body, 1000); if (!clean) return;
  db.prepare(`INSERT INTO hr_leave_comments
    (leave_request_id, author_employee_id, author_user_id, comment_type, body) VALUES (?, ?, ?, ?, ?)`)
    .run(requestId, employeeId, userId, type, clean);
}

function applyApprovedLeave(db, row, userId) {
  if (row.leave_type === "vacation" && !row.vacation_applied) {
    const profile = db.prepare("SELECT vacation_balance, vacation_debt FROM hr_employee_profiles WHERE employee_id = ?").get(row.employee_id);
    const requested = Number(row.working_days || row.total_days || 0);
    const balanceBefore = Number(profile?.vacation_balance || 0), debtBefore = Number(profile?.vacation_debt || 0);
    const availableBefore = Math.max(0, balanceBefore - debtBefore);
    const consumed = Math.min(availableBefore, requested), advanced = Math.max(0, requested - consumed);
    const balanceAfter = Math.max(0, balanceBefore - consumed), debtAfter = debtBefore + advanced;
    db.prepare("UPDATE hr_employee_profiles SET vacation_balance = ?, vacation_debt = ?, updated_at = CURRENT_TIMESTAMP WHERE employee_id = ?")
      .run(balanceAfter, debtAfter, row.employee_id);
    db.prepare(`INSERT INTO hr_vacation_balance_movements
      (employee_id, leave_request_id, movement_type, days, balance_before, balance_after, debt_before, debt_after, created_by, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.employee_id, row.id, advanced ? "advance" : "consumption", requested, balanceBefore,
        balanceAfter, debtBefore, debtAfter, userId, `Autorización ${row.folio}`);
    db.prepare("UPDATE hr_leave_requests SET vacation_applied = 1, vacation_advance = ? WHERE id = ?")
      .run(advanced ? 1 : 0, row.id);
  }
  if (row.leave_type === "permission" && row.is_unpaid) db.prepare(`INSERT INTO hr_payroll_incidents
    (leave_request_id, employee_id, incident_type, start_date, end_date, days, hours)
    VALUES (?, ?, 'unpaid_permission', ?, ?, ?, ?)
    ON CONFLICT(leave_request_id) DO NOTHING`)
    .run(row.id, row.employee_id, row.start_date, row.end_date, row.working_days || row.total_days, row.total_hours);
}

function restoreCancelledVacation(db, row, userId) {
  if (row.leave_type !== "vacation" || !row.vacation_applied) return;
  const movement = db.prepare(`SELECT * FROM hr_vacation_balance_movements WHERE leave_request_id = ?
    AND movement_type IN ('consumption', 'advance') ORDER BY id DESC LIMIT 1`).get(row.id);
  if (!movement) return;
  const current = db.prepare("SELECT vacation_balance, vacation_debt FROM hr_employee_profiles WHERE employee_id = ?").get(row.employee_id);
  db.prepare("UPDATE hr_employee_profiles SET vacation_balance = ?, vacation_debt = ?, updated_at = CURRENT_TIMESTAMP WHERE employee_id = ?")
    .run(movement.balance_before, movement.debt_before, row.employee_id);
  db.prepare(`INSERT INTO hr_vacation_balance_movements
    (employee_id, leave_request_id, movement_type, days, balance_before, balance_after, debt_before, debt_after, created_by, notes)
    VALUES (?, ?, 'restoration', ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.employee_id, row.id, movement.days, current.vacation_balance, movement.balance_before,
      current.vacation_debt, movement.debt_before, userId, `Cancelación ${row.folio}`);
  db.prepare("UPDATE hr_leave_requests SET vacation_applied = 0 WHERE id = ?").run(row.id);
  db.prepare("UPDATE hr_payroll_incidents SET status = 'cancelled' WHERE leave_request_id = ?").run(row.id);
}

function requireRecord(db, table, id, label) { if (!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)) throw new HrError(404, `${label} no encontrado.`); }
function optionalExistingId(db, table, value, label) { if (value == null || value === "") return null; const id = positiveId(value, label); requireRecord(db, table, id, label); return id; }
function optionalCatalogRecord(db, table, value, label) {
  if (value == null || value === "") return null;
  const id = positiveId(value, label);
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND is_active = 1`).get(id);
  if (!row) throw new HrError(404, `${label[0].toUpperCase() + label.slice(1)} no encontrado o inactivo.`);
  return row;
}
function positiveId(value, label) { const n = Number(value); if (!Number.isInteger(n) || n < 1) throw new HrError(400, `Selecciona un ${label} válido.`); return n; }
function requiredText(value, max, label) { const valueText = text(value, max); if (!valueText) throw new HrError(400, `${label} es obligatorio.`); return valueText; }
function text(value, max) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""; }
function email(value) { const valueText = text(value, 180); if (valueText && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valueText)) throw new HrError(400, "El correo no es válido."); return valueText; }
function enumRequired(value, allowed, label) { if (!allowed.includes(value)) throw new HrError(400, `Selecciona un ${label} válido.`); return value; }
function enumValue(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }
function flagValue(value) { return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0; }
function requiredDate(value) {
  const clean = String(value || "");
  const parsed = new Date(`${clean}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== clean) throw new HrError(400, "La fecha no es válida.");
  return clean;
}
function optionalDate(value) { return value ? requiredDate(value) : null; }
function dateTime(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) throw new HrError(400, "La fecha y hora no son válidas."); return date.toISOString().replace("T", " ").replace("Z", ""); }
function nonNegative(value, label) { const n = Number(value); if (!Number.isFinite(n) || n < 0) throw new HrError(400, `${label} no es válido.`); return Math.round(n * 100) / 100; }
function positiveNumber(value, label) { const number = nonNegative(value, label); if (number <= 0) throw new HrError(400, `${label} debe ser mayor que cero.`); return number; }
function integerBetween(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new HrError(400, `${label} no es válido.`);
  return number;
}
function timeValue(value, label) {
  const result = String(value || "");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result)) throw new HrError(400, `${label} no es válida.`);
  return result;
}
function workDayValues(value) {
  const allowed = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  if (!Array.isArray(value)) throw new HrError(400, "Selecciona al menos un día laboral.");
  const selected = allowed.filter((day) => value.includes(day));
  if (!selected.length || selected.length !== new Set(value).size) throw new HrError(400, "Los días laborales no son válidos.");
  return selected;
}
function weeklySchedule(body) {
  if (!Array.isArray(body.scheduleGroups) || !body.scheduleGroups.length) {
    return [{
      days: workDayValues(body.workDays),
      periods: [{
        start: timeValue(body.startTime, "La hora de inicio"),
        end: timeValue(body.endTime, "La hora de salida"),
      }],
    }];
  }
  if (body.scheduleGroups.length > 7) throw new HrError(400, "El turno no puede tener más de siete grupos de horario.");
  const usedDays = new Set();
  return body.scheduleGroups.map((group, groupIndex) => {
    const days = workDayValues(group?.days);
    for (const day of days) {
      if (usedDays.has(day)) throw new HrError(400, "Cada día solo puede pertenecer a un horario del turno.");
      usedDays.add(day);
    }
    if (!Array.isArray(group?.periods) || !group.periods.length || group.periods.length > 2)
      throw new HrError(400, `El horario ${groupIndex + 1} debe tener uno o dos bloques.`);
    const periods = group.periods.map((period, periodIndex) => {
      const start = timeValue(period?.start, `La entrada ${periodIndex + 1} del horario ${groupIndex + 1}`);
      const end = timeValue(period?.end, `La salida ${periodIndex + 1} del horario ${groupIndex + 1}`);
      if (start === end) throw new HrError(400, "La entrada y salida de un bloque no pueden ser iguales.");
      return { start, end };
    });
    if (periods.length === 2) {
      if (periods[0].end > periods[1].start)
        throw new HrError(400, `El segundo bloque del horario ${groupIndex + 1} debe comenzar después del primero.`);
      if (periods[0].start > periods[0].end || periods[1].start > periods[1].end)
        throw new HrError(400, "Los horarios divididos deben iniciar y terminar el mismo día.");
    }
    return { days, periods };
  });
}
function minutesBetween(start, end) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  return Math.max(0, Math.min(480, endHour * 60 + endMinute - startHour * 60 - startMinute));
}
function legacyShift(shift) {
  if (!shift) return "day";
  const byCode = { "TUR-00001": "day", "TUR-00002": "evening", "TUR-00003": "night", "TUR-00004": "mixed" };
  if (byCode[shift.code]) return byCode[shift.code];
  const hour = Number(String(shift.start_time).slice(0, 2));
  return hour >= 20 || hour < 5 ? "night" : hour >= 12 ? "evening" : "day";
}
function shiftSchedule(shift) {
  const schedule = parsedSchedule(shift.schedule_json);
  if (schedule.length) return schedule.map((group) => {
    const days = group.days.map((day) => ({ mon: "Lun", tue: "Mar", wed: "Mié", thu: "Jue", fri: "Vie", sat: "Sáb", sun: "Dom" })[day]).filter(Boolean).join(", ");
    return `${days}: ${group.periods.map((period) => `${period.start}–${period.end}`).join(" / ")}`;
  }).join(" · ");
  const labels = { mon: "Lun", tue: "Mar", wed: "Mié", thu: "Jue", fri: "Vie", sat: "Sáb", sun: "Dom" };
  const days = String(shift.work_days || "").split(",").map((day) => labels[day]).filter(Boolean).join(", ");
  return `${days} · ${shift.start_time}–${shift.end_time}`;
}
function parsedSchedule(value) {
  if (!value) return [];
  try {
    const schedule = JSON.parse(value);
    return Array.isArray(schedule) ? schedule : [];
  } catch {
    return [];
  }
}
function dateDays(start, end) { return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1; }
function today() { return new Date().toISOString().slice(0, 10); }
function serviceYears(hireDate) {
  if (!hireDate) return 0;
  const [hireYear, hireMonth, hireDay] = String(hireDate).slice(0, 10).split("-").map(Number);
  const [currentYear, currentMonth, currentDay] = today().split("-").map(Number);
  let years = currentYear - hireYear;
  if (currentMonth < hireMonth || (currentMonth === hireMonth && currentDay < hireDay)) years -= 1;
  return Math.max(0, years);
}
function automaticVacationPlan(db, hireDate) {
  const years = serviceYears(hireDate);
  if (years < 1) return null;
  return db.prepare(`SELECT * FROM hr_vacation_plans
    WHERE is_active = 1 AND min_service_years <= ?
      AND (max_service_years IS NULL OR max_service_years >= ?)
    ORDER BY min_service_years DESC,
      CASE WHEN max_service_years IS NULL THEN 1 ELSE 0 END,
      id DESC
    LIMIT 1`).get(years, years)
    || null;
}
function serviceDayCount(startDate, endDate) {
  if (!startDate || !endDate || endDate < startDate) return 0;
  return dateDays(startDate, endDate);
}
function plannedShiftHours(person, startDate, endDate) {
  if (!startDate || !endDate || endDate < startDate || !person.work_shift_id) return 0;
  const schedule = parsedSchedule(person.shift_schedule_json);
  const groups = schedule.length ? schedule : [{
    days: String(person.shift_work_days || "").split(",").filter(Boolean),
    periods: [{ start: person.shift_start_time, end: person.shift_end_time }],
  }];
  const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const limit = new Date(`${endDate}T00:00:00Z`);
  let minutes = 0;
  let iterations = 0;
  while (cursor <= limit && iterations < 3660) {
    const day = dayKeys[cursor.getUTCDay()];
    for (const group of groups) {
      if (!Array.isArray(group.days) || !group.days.includes(day)) continue;
      for (const period of Array.isArray(group.periods) ? group.periods : []) {
        if (!period?.start || !period?.end) continue;
        const [startHour, startMinute] = period.start.split(":").map(Number);
        const [endHour, endMinute] = period.end.split(":").map(Number);
        let duration = endHour * 60 + endMinute - (startHour * 60 + startMinute);
        if (duration <= 0) duration += 1440;
        minutes += Math.min(duration, 1440);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    iterations += 1;
  }
  return Math.round(minutes / 60 * 100) / 100;
}
function automaticVacationPlanFromList(plans, hireDate) {
  const years = serviceYears(hireDate);
  if (years < 1) return null;
  return plans.find((plan) => Number(plan.min_service_years || 0) <= years
    && (plan.max_service_years == null || Number(plan.max_service_years) >= years)) || null;
}
function validateLaborPlacement(db, { companyId, workCenterId, departmentId }) {
  if (workCenterId) {
    const center = db.prepare("SELECT company_id FROM hr_work_centers WHERE id = ?").get(workCenterId);
    if (!companyId || Number(center.company_id) !== Number(companyId))
      throw new HrError(400, "El centro de trabajo no pertenece a la empresa seleccionada.");
  }
  if (departmentId) {
    const department = db.prepare("SELECT company_id, work_center_id FROM hr_departments WHERE id = ?").get(departmentId);
    if (!companyId || Number(department.company_id) !== Number(companyId))
      throw new HrError(400, "El departamento no pertenece a la empresa seleccionada.");
    if (department.work_center_id && Number(department.work_center_id) !== Number(workCenterId || 0))
      throw new HrError(400, "El departamento no pertenece al centro de trabajo seleccionado.");
  }
}
function saveEmployeeIdentityDetails(db, employeeId, body, employmentType, hireDate, contractEndDate) {
  const hasPersonal = ["birthDate", "gender", "nationality", "maritalStatus", "street",
    "exteriorNumber", "interiorNumber", "neighborhood", "municipality", "addressState",
    "postalCode", "country"].some((key) => Object.hasOwn(body, key));
  if (hasPersonal) db.prepare(`INSERT INTO hr_employee_personal_data
    (employee_id, birth_date, gender, nationality, marital_status, street, exterior_number,
     interior_number, neighborhood, municipality, state, postal_code, country)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id) DO UPDATE SET birth_date = excluded.birth_date,
      gender = excluded.gender, nationality = excluded.nationality, marital_status = excluded.marital_status,
      street = excluded.street, exterior_number = excluded.exterior_number,
      interior_number = excluded.interior_number, neighborhood = excluded.neighborhood,
      municipality = excluded.municipality, state = excluded.state, postal_code = excluded.postal_code,
      country = excluded.country, updated_at = CURRENT_TIMESTAMP`)
    .run(employeeId, optionalDate(body.birthDate), text(body.gender, 40),
      text(body.nationality, 80) || "Mexicana", text(body.maritalStatus, 40), text(body.street, 180),
      text(body.exteriorNumber, 30), text(body.interiorNumber, 30), text(body.neighborhood, 120),
      text(body.municipality, 120), text(body.addressState, 120), text(body.postalCode, 10),
      text(body.country, 80) || "México");
  const hasFiscal = ["curp", "rfc", "nss", "taxRegime", "fiscalPostalCode"].some((key) => Object.hasOwn(body, key));
  if (hasFiscal) db.prepare(`INSERT INTO hr_employee_fiscal_data
    (employee_id, curp, rfc, nss, tax_regime, fiscal_postal_code)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id) DO UPDATE SET curp = excluded.curp, rfc = excluded.rfc, nss = excluded.nss,
      tax_regime = excluded.tax_regime, fiscal_postal_code = excluded.fiscal_postal_code,
      updated_at = CURRENT_TIMESTAMP`)
    .run(employeeId, text(body.curp, 24).toUpperCase(), text(body.rfc, 20).toUpperCase(),
      text(body.nss, 20), text(body.taxRegime, 120), text(body.fiscalPostalCode, 10));
  const hasLabor = ["contractType", "contractNumber", "contractStartDate", "payrollFrequency", "unionStatus"]
    .some((key) => Object.hasOwn(body, key));
  if (hasLabor) db.prepare(`INSERT INTO hr_employee_labor_data
    (employee_id, contract_type, contract_number, contract_start_date, contract_end_date, payroll_frequency, union_status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id) DO UPDATE SET contract_type = excluded.contract_type,
      contract_number = excluded.contract_number, contract_start_date = excluded.contract_start_date,
      contract_end_date = excluded.contract_end_date, payroll_frequency = excluded.payroll_frequency,
      union_status = excluded.union_status, updated_at = CURRENT_TIMESTAMP`)
    .run(employeeId, text(body.contractType, 80) || employmentType, text(body.contractNumber, 80),
      optionalDate(body.contractStartDate) || hireDate, contractEndDate, text(body.payrollFrequency, 40),
      text(body.unionStatus, 80));
  const hasCompensation = ["baseSalary", "currencyCode", "paymentMethod", "bankReference"]
    .some((key) => Object.hasOwn(body, key));
  if (hasCompensation) db.prepare(`INSERT INTO hr_employee_compensation_private
    (employee_id, base_salary, currency_code, payment_method, bank_reference)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(employee_id) DO UPDATE SET base_salary = excluded.base_salary,
      currency_code = excluded.currency_code, payment_method = excluded.payment_method,
      bank_reference = excluded.bank_reference, updated_at = CURRENT_TIMESTAMP`)
    .run(employeeId, Math.max(0, Number(body.baseSalary || 0)), text(body.currencyCode, 8).toUpperCase() || "MXN",
      text(body.paymentMethod, 80), text(body.bankReference, 120));
  const hasMedical = ["bloodType", "allergies", "conditions", "occupationalNotes"]
    .some((key) => Object.hasOwn(body, key));
  if (hasMedical) db.prepare(`INSERT INTO hr_employee_medical_private
    (employee_id, blood_type, allergies, conditions, occupational_notes)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(employee_id) DO UPDATE SET blood_type = excluded.blood_type,
      allergies = excluded.allergies, conditions = excluded.conditions,
      occupational_notes = excluded.occupational_notes, updated_at = CURRENT_TIMESTAMP`)
    .run(employeeId, text(body.bloodType, 10), text(body.allergies, 1000), text(body.conditions, 1000),
      text(body.occupationalNotes, 2000));
}
function employeeFileStatusContext(db) {
  const requiredDocumentTypes = db.prepare(`SELECT id, code, name FROM hr_document_types
    WHERE is_active = 1 AND required_for_active = 1 ORDER BY name`).all();
  const currentDocuments = db.prepare(`SELECT d.employee_id, d.document_type_id, d.expiry_date, dt.name
    FROM documents d LEFT JOIN hr_document_types dt ON dt.id = d.document_type_id
    WHERE d.employee_id IS NOT NULL AND d.is_current = 1 AND d.deleted_at IS NULL`).all();
  const documentsByEmployee = new Map();
  for (const document of currentDocuments) {
    const employeeId = Number(document.employee_id);
    if (!documentsByEmployee.has(employeeId)) documentsByEmployee.set(employeeId, []);
    documentsByEmployee.get(employeeId).push(document);
  }
  return { requiredDocumentTypes, documentsByEmployee };
}
function employeeFileStatus(person, context) {
  const requiredFields = [
    ["curp", "CURP"], ["rfc", "RFC"], ["nss", "NSS"], ["birth_date", "Fecha de nacimiento"],
    ["street", "Calle"], ["neighborhood", "Colonia"], ["municipality", "Municipio"],
    ["address_state", "Estado"], ["postal_code", "Código postal"],
    ["emergency_contact", "Contacto de emergencia"], ["emergency_phone", "Teléfono de emergencia"],
    ["company_id", "Empresa"], ["work_center_id", "Centro de trabajo"],
    ["department_id", "Departamento"], ["area_id", "Área"], ["position_id", "Puesto"],
    ["hire_date", "Fecha de ingreso"], ["employment_type", "Tipo de contratación"],
    ["contract_type", "Contrato"], ["payroll_frequency", "Periodicidad de nómina"],
  ];
  const missingFields = requiredFields.filter(([key]) => !String(person[key] ?? "").trim()).map(([, label]) => label);
  const requiredDocumentTypes = context.requiredDocumentTypes;
  const currentDocuments = context.documentsByEmployee.get(Number(person.id)) || [];
  const currentTypeIds = new Set(currentDocuments.map((row) => Number(row.document_type_id || 0)));
  const missingDocuments = requiredDocumentTypes
    .filter((row) => !currentTypeIds.has(Number(row.id))).map((row) => row.name);
  const warningDate = dateAfterDays(90);
  const todayValue = today();
  const documentAlerts = currentDocuments.filter((row) => row.expiry_date && row.expiry_date <= warningDate)
    .map((row) => ({
      type: row.expiry_date < todayValue ? "expired" : "expiring",
      documentName: row.name || "Documento",
      expiryDate: row.expiry_date,
    }));
  const totalChecks = requiredFields.length + requiredDocumentTypes.length;
  const pendingChecks = missingFields.length + missingDocuments.length;
  return {
    file_complete: pendingChecks === 0,
    file_completion_percent: totalChecks ? Math.round((totalChecks - pendingChecks) / totalChecks * 100) : 100,
    missing_file_fields: missingFields,
    missing_file_documents: missingDocuments,
    document_expiry_alerts: documentAlerts,
  };
}
function dateAfterDays(days) {
  const value = new Date(`${today()}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function employmentDetails(body, employmentType, hireDate) {
  const details = {
    contractEndDate: null,
    organizationName: "",
    organizationDetails: "",
    organizationContactName: "",
    organizationContactPhone: "",
    organizationContactEmail: "",
    advisorName: "",
    advisorPhone: "",
    advisorEmail: "",
    serviceStartDate: null,
    serviceEndDate: null,
    requiredServiceHours: 0,
  };
  if (employmentType === "temporary") {
    details.contractEndDate = requiredDate(body.contractEndDate);
    if (hireDate && details.contractEndDate < hireDate) {
      throw new HrError(400, "La fecha final del contrato no puede ser anterior a la fecha de alta.");
    }
  }
  if (employmentType === "contractor" || employmentType === "intern") {
    details.organizationName = requiredText(body.organizationName, 180,
      employmentType === "contractor" ? "La empresa de procedencia" : "La institución");
    details.organizationDetails = text(body.organizationDetails, 500);
    details.organizationContactName = text(body.organizationContactName, 180);
    details.organizationContactPhone = text(body.organizationContactPhone, 40);
    details.organizationContactEmail = email(body.organizationContactEmail);
    details.serviceStartDate = requiredDate(body.serviceStartDate);
    details.serviceEndDate = requiredDate(body.serviceEndDate);
    if (details.serviceEndDate < details.serviceStartDate) {
      throw new HrError(400, "La fecha final del servicio no puede ser anterior a la fecha inicial.");
    }
  }
  if (employmentType === "intern") {
    details.advisorName = requiredText(body.advisorName, 180, "El asesor");
    details.advisorPhone = text(body.advisorPhone, 40);
    details.advisorEmail = email(body.advisorEmail);
    details.requiredServiceHours = positiveNumber(body.requiredServiceHours, "Las horas requeridas");
  }
  return details;
}
function placeholder(kind) { return `AUTO-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function constraint(error, message) { if (String(error?.message || "").includes("UNIQUE constraint failed")) throw new HrError(409, message); throw error; }
function transaction(db, work) { db.exec("BEGIN IMMEDIATE"); try { const result = work(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } }
