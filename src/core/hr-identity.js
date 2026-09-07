export function laborIdentityForUser(db, userId) {
  const row = db.prepare(`SELECT user_id, employee_id, identity_type, access_scope, access_status,
    can_view_salary, can_view_cfdi, can_view_medical, created_at, updated_at
    FROM hr_user_access WHERE user_id = ?`).get(userId);
  if (!row) return null;
  return {
    userId: Number(row.user_id),
    employeeId: row.employee_id == null ? null : Number(row.employee_id),
    identityType: row.identity_type,
    accessScope: row.access_scope,
    accessStatus: row.access_status,
    canViewSalary: Boolean(row.can_view_salary),
    canViewCfdi: Boolean(row.can_view_cfdi),
    canViewMedical: Boolean(row.can_view_medical),
    companyIds: db.prepare("SELECT company_id FROM hr_user_company_scopes WHERE user_id = ? ORDER BY company_id")
      .all(userId).map((item) => Number(item.company_id)),
    workCenterIds: db.prepare("SELECT work_center_id FROM hr_user_work_center_scopes WHERE user_id = ? ORDER BY work_center_id")
      .all(userId).map((item) => Number(item.work_center_id)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function visibleEmployeeIds(db, userId, knownIdentity = undefined) {
  const identity = knownIdentity === undefined ? laborIdentityForUser(db, userId) : knownIdentity;
  // Los usuarios existentes sin identidad conservan el comportamiento anterior.
  // Todo usuario creado o actualizado desde el Centro recibe una identidad explicita.
  if (!identity) return null;
  if (identity.accessStatus !== "active") return new Set();
  if (identity.accessScope === "own")
    return new Set(identity.employeeId ? [identity.employeeId] : []);
  if (identity.accessScope === "team") {
    if (!identity.employeeId) return new Set();
    const reports = db.prepare(`SELECT e.id FROM employees e
      JOIN hr_employee_profiles p ON p.employee_id = e.id
      WHERE p.manager_employee_id = ?`).all(identity.employeeId);
    return new Set([identity.employeeId, ...reports.map((row) => Number(row.id))]);
  }
  if (identity.accessScope === "center") {
    if (!identity.workCenterIds.length) return new Set();
    const placeholders = identity.workCenterIds.map(() => "?").join(",");
    return new Set(db.prepare(`SELECT id FROM employees WHERE work_center_id IN (${placeholders})`)
      .all(...identity.workCenterIds).map((row) => Number(row.id)));
  }
  // En el modelo simplificado del Centro, una lista vacia representa toda la
  // empresa alojada en esta base tenant. Se devuelve el conjunto completo para
  // conservar la aplicacion de permisos sensibles y el filtrado de documentos.
  if (!identity.companyIds.length)
    return new Set(db.prepare("SELECT id FROM employees").all().map((row) => Number(row.id)));
  const placeholders = identity.companyIds.map(() => "?").join(",");
  return new Set(db.prepare(`SELECT id FROM employees WHERE company_id IN (${placeholders})`)
    .all(...identity.companyIds).map((row) => Number(row.id)));
}

export function canAccessEmployee(db, userId, employeeId) {
  const visible = visibleEmployeeIds(db, userId);
  return visible === null || visible.has(Number(employeeId));
}

export function assertEmployeeAccess(db, userId, employeeId, ErrorType = Error) {
  if (!canAccessEmployee(db, userId, employeeId))
    throw new ErrorType(403, "No tienes acceso al expediente de este trabajador.");
}

export function filterHrControl(db, userId, payload) {
  const identity = laborIdentityForUser(db, userId);
  const visible = visibleEmployeeIds(db, userId, identity);
  if (visible === null) return { ...payload, laborIdentity: null };
  const people = payload.people
    .filter((row) => visible.has(Number(row.id)))
    .map((row) => identity?.canViewSalary ? row : redactSalary(row));
  const leaves = payload.leaves
    .filter((row) => visible.has(Number(row.employee_id)))
    .map((row) => identity?.canViewMedical ? row : redactMedicalLeave(row));
  const attendance = payload.attendance.filter((row) => visible.has(Number(row.employee_id)));
  const currentMonth = new Date().toISOString().slice(0, 7);
  const activePeople = people.filter((row) => row.status === "active").length;
  const staffEntriesMonth = people.filter((row) => String(row.hire_date || row.created_at || "").slice(0, 7) === currentMonth).length;
  const staffExitsMonth = people.filter((row) => row.status === "inactive"
    && String(row.updated_at || "").slice(0, 7) === currentMonth).length;
  return {
    ...payload,
    people,
    leaves,
    attendance,
    laborIdentity: identity,
    indicators: {
      activePeople,
      pendingRequests: leaves.filter((row) => row.status === "submitted").length,
      awayToday: leaves.filter((row) => row.status === "approved"
        && row.start_date <= new Date().toISOString().slice(0, 10)
        && row.end_date >= new Date().toISOString().slice(0, 10)).length,
      staffEntriesMonth,
      staffExitsMonth,
      turnoverRate: Math.round(staffExitsMonth / Math.max(1, activePeople + staffExitsMonth / 2) * 1000) / 10,
    },
  };
}

export function canAccessSensitiveDocument(identity, sensitivity) {
  if (!identity || sensitivity === "standard" || sensitivity === "fiscal") return true;
  if (sensitivity === "salary") return identity.canViewSalary;
  if (sensitivity === "cfdi") return identity.canViewCfdi;
  if (sensitivity === "medical") return identity.canViewMedical;
  return false;
}

export function redactMedicalLeave(row) {
  if (row.leave_type !== "incapacity") return row;
  return { ...row, subtype: "", reason: "Informaci\u00f3n m\u00e9dica restringida", certificate_number: "", medical_provider: "" };
}

function redactSalary(row) {
  const copy = { ...row };
  delete copy.base_salary;
  delete copy.currency_code;
  delete copy.payment_method;
  delete copy.bank_reference;
  return copy;
}
