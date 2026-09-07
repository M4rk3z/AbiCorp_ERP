import { hashPassword } from "./security.js";
import { moduleCatalog, replaceUserModuleAccess } from "./access.js";

const DEMO_SEED_VERSION = "medium-company-v3";
export const DEMO_TEMPORARY_PASSWORD = "Demo2026!";

const AREAS = [
  ["DIR", "Dirección General", "Planeación y gobierno de la empresa"],
  ["RH", "Recursos Humanos", "Personal, cultura y relaciones laborales"],
  ["FIN", "Finanzas y Administración", "Tesorería, contabilidad y control"],
  ["COM", "Comercial", "Ventas, atención y desarrollo de clientes"],
  ["PROD", "Producción", "Manufactura y cumplimiento del programa"],
  ["CAL", "Calidad", "Aseguramiento y mejora continua"],
  ["MANT", "Mantenimiento", "Confiabilidad de equipos e instalaciones"],
  ["LOG", "Logística y Almacén", "Inventarios, embarques y distribución"],
];

const POSITIONS = [
  ["DG", "Dirección General", "Responsable de la estrategia y resultados"],
  ["GRH", "Gerencia de Recursos Humanos", "Responsable integral del personal"],
  ["ARH", "Auxiliar de Recursos Humanos", "Soporte de expedientes e incidencias"],
  ["GAF", "Gerencia Administrativa y Financiera", "Control financiero y administrativo"],
  ["EVE", "Ejecutivo de Ventas", "Prospección y atención de cuentas"],
  ["SUP", "Supervisión de Producción", "Coordinación del programa productivo"],
  ["OPE", "Operación de Producción", "Ejecución de operaciones de manufactura"],
  ["CAL", "Inspección de Calidad", "Validación de producto y proceso"],
  ["TEC", "Técnico de Mantenimiento", "Mantenimiento preventivo y correctivo"],
  ["ALM", "Almacenista", "Recepción, surtido e inventarios"],
  ["LOG", "Coordinación Logística", "Programación de rutas y entregas"],
];

const POSITION_PROFILES = {
  DG: ["Licenciatura en Administración, Ingeniería o afín.", "8 años en dirección o liderazgo empresarial.", "Estrategia, finanzas y gobierno corporativo.", "Negociación, análisis y toma de decisiones.", "Liderazgo, visión de negocio y orientación a resultados."],
  GRH: ["Licenciatura en Administración, Psicología o afín.", "5 años en gestión integral de Recursos Humanos.", "Legislación laboral, nómina, desarrollo y relaciones laborales.", "Comunicación, negociación y planeación.", "Liderazgo, confidencialidad y orientación a las personas."],
  ARH: ["Licenciatura en Administración, Psicología o afín.", "2 años en Recursos Humanos.", "Excel, expedientes, reclutamiento y sistemas de nómina.", "Comunicación, organización y trabajo en equipo.", "Orientación a resultados, servicio y atención al detalle."],
  GAF: ["Licenciatura en Contaduría, Finanzas o Administración.", "5 años en administración y finanzas.", "Contabilidad, tesorería, presupuestos e impuestos.", "Análisis financiero, planeación y negociación.", "Integridad, liderazgo y control."],
  EVE: ["Licenciatura o carrera técnica comercial.", "2 años en ventas consultivas.", "Prospección, CRM, cotizaciones y servicio al cliente.", "Comunicación, negociación y seguimiento.", "Orientación al cliente y a resultados."],
  SUP: ["Ingeniería Industrial, Mecánica o afín.", "4 años en procesos de manufactura y supervisión.", "Planeación de producción, seguridad, calidad y mejora continua.", "Coordinación, análisis y solución de problemas.", "Liderazgo operativo y disciplina."],
  OPE: ["Secundaria o carrera técnica industrial.", "1 año en operación de manufactura.", "Instrucciones de trabajo, seguridad y control de calidad.", "Destreza manual, orden y trabajo en equipo.", "Responsabilidad, disciplina y atención al detalle."],
  CAL: ["Carrera técnica o ingeniería afín.", "2 años en inspección de calidad.", "Metrología, interpretación de planos y control de proceso.", "Análisis, documentación y comunicación.", "Objetividad, precisión y enfoque preventivo."],
  TEC: ["Carrera técnica en mantenimiento, electricidad o mecánica.", "3 años en mantenimiento industrial.", "Mecánica, electricidad, diagnóstico y seguridad.", "Diagnóstico, uso de herramientas y solución de fallas.", "Disponibilidad, orden y orientación al servicio."],
  ALM: ["Bachillerato o carrera técnica.", "1 año en almacenes o inventarios.", "Recepción, surtido, conteos y manejo de materiales.", "Organización, captura y trabajo en equipo.", "Honestidad, orden y sentido de urgencia."],
  LOG: ["Licenciatura en Logística, Ingeniería o afín.", "3 años en distribución y transporte.", "Rutas, embarques, inventarios y proveedores logísticos.", "Planeación, negociación y seguimiento.", "Orientación al cliente y solución de problemas."],
};

const PEOPLE = [
  ["E-00001", "Daniela Torres Vega", "DIR", "DG", 62000],
  ["E-00002", "Mariana López Cortés", "RH", "GRH", 38000],
  ["E-00003", "Luis Herrera Campos", "RH", "ARH", 18500],
  ["E-00004", "Sofía Mendoza Ruiz", "FIN", "GAF", 42000],
  ["E-00005", "Andrés Castillo Mora", "FIN", "ARH", 21500],
  ["E-00006", "Renata Silva Ortiz", "COM", "EVE", 24000],
  ["E-00007", "Jorge Ramírez Soto", "COM", "EVE", 23500],
  ["E-00008", "Camila Navarro León", "COM", "EVE", 22800],
  ["E-00009", "Miguel Ángel Reyes", "PROD", "SUP", 32000],
  ["E-00010", "Fernanda Cruz Lara", "PROD", "OPE", 16800],
  ["E-00011", "Alejandro Vega Silva", "PROD", "OPE", 17100],
  ["E-00012", "Brenda González Ruiz", "PROD", "OPE", 16900],
  ["E-00013", "Carlos Hernández Cruz", "PROD", "OPE", 16600],
  ["E-00014", "Paola Martínez Reyes", "PROD", "OPE", 17300],
  ["E-00015", "Ricardo Flores Luna", "PROD", "OPE", 17000],
  ["E-00016", "Natalia García Peña", "PROD", "OPE", 16850],
  ["E-00017", "Héctor Salas Díaz", "PROD", "OPE", 17600],
  ["E-00018", "Valeria Ríos Acosta", "PROD", "OPE", 16750],
  ["E-00019", "Óscar Medina Paz", "CAL", "CAL", 22400],
  ["E-00020", "Lucía Aguilar Núñez", "CAL", "CAL", 21800],
  ["E-00021", "Eduardo Moreno Gil", "CAL", "CAL", 21300],
  ["E-00022", "Gabriela Romero Ibarra", "MANT", "TEC", 24600],
  ["E-00023", "Iván Sánchez Ponce", "MANT", "TEC", 23800],
  ["E-00024", "Mónica Valdez Tapia", "MANT", "TEC", 23200],
  ["E-00025", "Arturo Jiménez Solís", "LOG", "LOG", 28500],
  ["E-00026", "Regina Espinoza Cano", "LOG", "ALM", 17400],
  ["E-00027", "Diego Cabrera Nieto", "LOG", "ALM", 17100],
  ["E-00028", "Ximena Fuentes Rojo", "LOG", "ALM", 16900],
  ["E-00029", "Emilio Vargas Rojas", "LOG", "ALM", 17200],
  ["E-00030", "Patricia Ortega Vidal", "FIN", "ARH", 20700],
];

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function mondayForCurrentWeek() {
  const date = new Date(`${isoDate()}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function idBy(db, table, field, value) {
  const row = db.prepare(`SELECT id FROM ${table} WHERE ${field} = ?`).get(value);
  if (!row) throw new Error(`No se encontró ${table}.${field}: ${value}`);
  return Number(row.id);
}

function insertIgnore(db, sql, ...values) {
  db.prepare(sql).run(...values);
}

function seedOrganization(db, companyId) {
  const branchRows = [
    ["MTY", "Planta Monterrey", "Parque Industrial Demo 100, Monterrey, N.L."],
    ["QRO", "Centro de Distribución Querétaro", "Circuito Empresarial Demo 25, Querétaro, Qro."],
  ];
  for (const [code, name, address] of branchRows)
    insertIgnore(db, `INSERT INTO branches (company_id, code, name, address, timezone)
      VALUES (?, ?, ?, ?, 'America/Chicago') ON CONFLICT(company_id, code) DO NOTHING`, companyId, code, name, address);

  for (const [code, name, description] of AREAS)
    insertIgnore(db, `INSERT INTO areas (code, name, description) VALUES (?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET name = excluded.name, description = excluded.description`, code, name, description);
  for (const [code, name, description] of POSITIONS) {
    const profile = POSITION_PROFILES[code] || ["", "", "", "", ""];
    insertIgnore(db, `INSERT INTO hr_job_positions
      (code, name, description, profile_education, profile_experience, profile_knowledge,
       profile_skills, profile_competencies)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET name = excluded.name, description = excluded.description,
        profile_education = excluded.profile_education, profile_experience = excluded.profile_experience,
        profile_knowledge = excluded.profile_knowledge, profile_skills = excluded.profile_skills,
        profile_competencies = excluded.profile_competencies`,
      code, name, description, ...profile);
  }

  for (const [code, name] of branchRows) {
    const branchId = idBy(db, "branches", "code", code);
    insertIgnore(db, `INSERT INTO hr_work_centers (company_id, branch_id, code, name, center_type, timezone)
      VALUES (?, ?, ?, ?, 'plant', 'America/Chicago') ON CONFLICT(company_id, code) DO NOTHING`, companyId, branchId, code, name);
  }
  const mainCenter = idBy(db, "hr_work_centers", "code", "MTY");
  for (const [code, name] of AREAS) {
    const areaId = idBy(db, "areas", "code", code);
    insertIgnore(db, `INSERT INTO hr_departments (company_id, work_center_id, area_id, code, name)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(company_id, code) DO NOTHING`, companyId, mainCenter, areaId, code, name);
  }
  const mainBranch = idBy(db, "branches", "code", "MTY");
  const distributionBranch = idBy(db, "branches", "code", "QRO");
  insertIgnore(db, `INSERT INTO warehouses (branch_id, code, name, description) VALUES (?, 'ALM-MTY', 'Almacén principal', 'Materias primas y producto terminado') ON CONFLICT(branch_id, code) DO NOTHING`, mainBranch);
  insertIgnore(db, `INSERT INTO warehouses (branch_id, code, name, description) VALUES (?, 'CEDIS-QRO', 'CEDIS Querétaro', 'Distribución regional') ON CONFLICT(branch_id, code) DO NOTHING`, distributionBranch);
  const warehouseId = idBy(db, "warehouses", "code", "ALM-MTY");
  insertIgnore(db, `INSERT INTO inventory_locations (code, warehouse_id, name, zone, aisle, rack)
    VALUES ('MP-A01', ?, 'Materia prima A-01', 'MP', 'A', '01') ON CONFLICT(code) DO NOTHING`, warehouseId);
  insertIgnore(db, `INSERT INTO inventory_locations (code, warehouse_id, name, zone, aisle, rack)
    VALUES ('PT-B01', ?, 'Producto terminado B-01', 'PT', 'B', '01') ON CONFLICT(code) DO NOTHING`, warehouseId);
}

function seedEmployees(db, companyId) {
  const centerId = idBy(db, "hr_work_centers", "code", "MTY");
  const dayShift = db.prepare("SELECT id FROM hr_work_shifts WHERE code = 'DAY'").get()?.id
    ?? db.prepare("SELECT id FROM hr_work_shifts ORDER BY id LIMIT 1").get()?.id ?? null;
  const vacationPlan = db.prepare("SELECT id FROM hr_vacation_plans ORDER BY annual_days DESC, id LIMIT 1").get()?.id ?? null;
  const insertEmployee = db.prepare(`INSERT INTO employees
    (employee_number, full_name, email, phone, area_id, position, position_id, company_id, work_center_id, department_id, hire_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active') ON CONFLICT(employee_number) DO NOTHING`);
  const passwordHash = hashPassword(DEMO_TEMPORARY_PASSWORD);

  PEOPLE.forEach(([number, name, areaCode, positionCode, salary], index) => {
    const areaId = idBy(db, "areas", "code", areaCode);
    const positionId = idBy(db, "hr_job_positions", "code", positionCode);
    const departmentId = idBy(db, "hr_departments", "code", areaCode);
    const emailName = number.replace(/[^0-9]/g, "");
    const hireDate = addDays(isoDate(-1095), index * 19);
    insertEmployee.run(number, name, `colaborador${emailName}@nova-demo.example`, `81${String(10000000 + index).slice(-8)}`,
      areaId, POSITIONS.find((row) => row[0] === positionCode)?.[1] || "Colaborador", positionId,
      companyId, centerId, departmentId, hireDate);
    const employeeId = idBy(db, "employees", "employee_number", number);
    insertIgnore(db, `INSERT INTO hr_employee_profiles
      (employee_id, employment_type, shift, work_schedule, emergency_contact, emergency_phone,
       emergency_relationship, vacation_balance, work_shift_id, vacation_plan_id, vacation_cycle_year, notes)
      VALUES (?, 'permanent', 'day', 'Lunes a viernes · 08:00 a 17:00', ?, ?, ?, ?, ?, ?, ?, 'Registro ficticio para demostración')
      ON CONFLICT(employee_id) DO NOTHING`, employeeId, `Contacto ${index + 1}`, `81${String(90000000 + index).slice(-8)}`,
      index % 2 ? "Familiar" : "Cónyuge", 12 + (index % 7), dayShift, vacationPlan, new Date().getUTCFullYear());
    insertIgnore(db, `INSERT INTO hr_employee_fiscal_data (employee_id, curp, rfc, nss, tax_regime, fiscal_postal_code)
      VALUES (?, ?, ?, ?, '605', '64000') ON CONFLICT(employee_id) DO NOTHING`, employeeId,
      `DEMO900101${index % 2 ? "M" : "H"}NLABC${String(index + 1).padStart(2, "0")}`,
      `DMOX900101${String(index + 1).padStart(3, "0")}`, `900101${String(index + 1).padStart(5, "0")}`);
    insertIgnore(db, `INSERT INTO hr_employee_labor_data
      (employee_id, contract_type, contract_number, contract_start_date, payroll_frequency, union_status)
      VALUES (?, 'permanent', ?, ?, 'biweekly', 'non_union') ON CONFLICT(employee_id) DO NOTHING`, employeeId, `CONT-${number}`, hireDate);
    insertIgnore(db, `INSERT INTO hr_employee_compensation_private
      (employee_id, base_salary, currency_code, payment_method, bank_reference)
      VALUES (?, ?, 'MXN', 'transfer', ?) ON CONFLICT(employee_id) DO NOTHING`, employeeId, salary, `DEMO-${String(index + 1).padStart(4, "0")}`);
    insertIgnore(db, `INSERT INTO hr_employee_personal_data
      (employee_id, birth_date, gender, nationality, marital_status, street, exterior_number, neighborhood, municipality, state, postal_code, country)
      VALUES (?, ?, ?, 'Mexicana', ?, 'Avenida Demostración', ?, 'Colonia Centro', 'Monterrey', 'Nuevo León', '64000', 'México')
      ON CONFLICT(employee_id) DO NOTHING`, employeeId, addDays("1988-01-01", index * 173), index % 2 ? "female" : "male",
      index % 3 ? "single" : "married", String(100 + index));
  });

  const managers = { DIR: "E-00001", RH: "E-00002", FIN: "E-00004", COM: "E-00006", PROD: "E-00009", CAL: "E-00019", MANT: "E-00022", LOG: "E-00025" };
  for (const [number, , areaCode] of PEOPLE) {
    const employeeId = idBy(db, "employees", "employee_number", number);
    const managerNumber = managers[areaCode];
    const managerId = managerNumber === number ? idBy(db, "employees", "employee_number", "E-00001") : idBy(db, "employees", "employee_number", managerNumber);
    db.prepare("UPDATE hr_employee_profiles SET manager_employee_id = ? WHERE employee_id = ?").run(managerId === employeeId ? null : managerId, employeeId);
  }

  const demoUsers = [
    ["demo.admin", "Administrador Demo", "admin.demo@nova-demo.example", "ADMIN", "E-00001", 4],
    ["demo.rh", "Mariana López Cortés", "rh.demo@nova-demo.example", "SUPERVISOR", "E-00002", 3],
    ["demo.finanzas", "Sofía Mendoza Ruiz", "finanzas.demo@nova-demo.example", "SUPERVISOR", "E-00004", 3],
    ["demo.ventas", "Renata Silva Ortiz", "ventas.demo@nova-demo.example", "OPERATIVO", "E-00006", 2],
    ["demo.produccion", "Miguel Ángel Reyes", "produccion.demo@nova-demo.example", "OPERATIVO", "E-00009", 2],
    ["demo.auditor", "Auditor Demo", "auditor.demo@nova-demo.example", "CONSULTA", null, 1],
  ];
  for (const [username, fullName, email, roleCode, employeeNumber, level] of demoUsers) {
    insertIgnore(db, `INSERT INTO users (username, full_name, email, password_hash, status, must_change_password)
      VALUES (?, ?, ?, ?, 'active', 0) ON CONFLICT(username) DO NOTHING`, username, fullName, email, passwordHash);
    const userId = idBy(db, "users", "username", username);
    const roleId = idBy(db, "roles", "code", roleCode);
    insertIgnore(db, "INSERT INTO user_roles (user_id, role_id) VALUES (?, ?) ON CONFLICT(user_id, role_id) DO NOTHING", userId, roleId);
    replaceUserModuleAccess(db, userId, moduleCatalog.map((module) => ({ key: module.key, level })));
    if (employeeNumber) {
      const employeeId = idBy(db, "employees", "employee_number", employeeNumber);
      const areaId = db.prepare("SELECT area_id FROM employees WHERE id = ?").get(employeeId).area_id;
      insertIgnore(db, "INSERT INTO user_areas (user_id, area_id, is_primary) VALUES (?, ?, 1) ON CONFLICT(user_id, area_id) DO UPDATE SET is_primary = 1", userId, areaId);
      insertIgnore(db, `INSERT INTO hr_user_access (user_id, employee_id, identity_type, access_scope, can_view_salary, can_view_cfdi, can_view_medical, access_status)
        VALUES (?, ?, ?, 'company', ?, ?, ?, 'active') ON CONFLICT(user_id) DO UPDATE SET
          employee_id = excluded.employee_id, identity_type = excluded.identity_type,
          access_scope = excluded.access_scope, can_view_salary = excluded.can_view_salary,
          can_view_cfdi = excluded.can_view_cfdi, can_view_medical = excluded.can_view_medical,
          access_status = excluded.access_status`,
      userId, employeeId, level >= 4 ? "manager" : level >= 3 ? "hr" : "worker",
      level >= 3 ? 1 : 0, level >= 3 ? 1 : 0, level >= 4 || username === "demo.rh" ? 1 : 0);
    }
  }
  return { passwordHash };
}

function seedCatalogsAndOperations(db) {
  const mxn = idBy(db, "currencies", "code", "MXN");
  const unit = db.prepare("SELECT id FROM units_of_measure WHERE code IN ('PZA', 'EA') ORDER BY id LIMIT 1").get()?.id
    ?? db.prepare("SELECT id FROM units_of_measure ORDER BY id LIMIT 1").get().id;
  const warehouseId = idBy(db, "warehouses", "code", "ALM-MTY");
  const mpLocation = idBy(db, "inventory_locations", "code", "MP-A01");
  const ptLocation = idBy(db, "inventory_locations", "code", "PT-B01");
  const items = [
    ["MP-ACERO", "Lámina de acero calibre 18", "raw_material", 420, 0, 100],
    ["MP-PINT", "Pintura electrostática verde", "raw_material", 185, 0, 60],
    ["MP-EMP", "Empaque industrial", "consumable", 18, 0, 200],
    ["PT-EST01", "Estación modular Nova", "finished", 2450, 4950, 20],
    ["PT-CAR01", "Carro de servicio Nova", "finished", 1850, 3750, 15],
    ["REF-BAL", "Balero industrial 6204", "consumable", 95, 0, 12],
    ["HER-TOR", "Torquímetro 20-100 Nm", "tool", 2800, 0, 2],
    ["SER-INST", "Servicio de instalación", "service", 900, 1800, 0],
  ];
  for (const [sku, name, type, cost, price, minimum] of items)
    insertIgnore(db, `INSERT INTO items
      (sku, name, item_type, description, unit_id, currency_id, standard_cost, list_price, tax_rate, min_stock, max_stock, inventory_tracked, purchase_enabled, sales_enabled, production_enabled)
      VALUES (?, ?, ?, 'Dato ficticio de demostración', ?, ?, ?, ?, 16, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sku) DO NOTHING`, sku, name, type, unit, mxn, cost, price, minimum, Math.max(minimum * 4, 20),
      type === "service" ? 0 : 1, type === "finished" ? 0 : 1, ["finished", "service"].includes(type) ? 1 : 0, type === "finished" ? 1 : 0);
  for (const [code, legalName, terms] of [
    ["CLI-001", "Comercializadora Horizonte Demo, S.A. de C.V.", 30], ["CLI-002", "Equipamiento del Bajío Demo, S.A.", 15],
    ["CLI-003", "Servicios Industriales Norte Demo, S. de R.L.", 30], ["CLI-004", "Distribuciones Nova Demo, S.A.", 45],
  ]) insertIgnore(db, `INSERT INTO customers (code, legal_name, trade_name, tax_id, email, phone, address, currency_id, credit_limit, payment_terms_days)
    VALUES (?, ?, ?, '', ?, '8100000000', 'Domicilio ficticio', ?, 250000, ?) ON CONFLICT(code) DO NOTHING`, code, legalName, legalName.replace(" Demo", ""), `${code.toLowerCase()}@example.com`, mxn, terms);
  for (const [code, legalName, lead] of [
    ["PRO-001", "Aceros Demo del Norte, S.A.", 7], ["PRO-002", "Recubrimientos Demo MX, S.A.", 5],
    ["PRO-003", "Empaques Ficticios del Centro, S.A.", 3], ["PRO-004", "Refacciones Demo Industrial, S.A.", 2],
  ]) insertIgnore(db, `INSERT INTO suppliers (code, legal_name, trade_name, tax_id, email, phone, address, currency_id, payment_terms_days, lead_time_days)
    VALUES (?, ?, ?, '', ?, '8100000000', 'Domicilio ficticio', ?, 30, ?) ON CONFLICT(code) DO NOTHING`, code, legalName, legalName.replace(" Demo", ""), `${code.toLowerCase()}@example.com`, mxn, lead);

  const adminId = idBy(db, "users", "username", "demo.admin");
  for (const [sku, qty, location] of [["MP-ACERO", 240, mpLocation], ["MP-PINT", 95, mpLocation], ["MP-EMP", 600, mpLocation], ["PT-EST01", 24, ptLocation], ["PT-CAR01", 18, ptLocation], ["REF-BAL", 30, mpLocation]]) {
    const itemId = idBy(db, "items", "sku", sku);
    insertIgnore(db, `INSERT INTO inventory_balances (item_id, warehouse_id, location_id, quantity, average_cost)
      VALUES (?, ?, ?, ?, (SELECT standard_cost FROM items WHERE id = ?)) ON CONFLICT DO NOTHING`, itemId, warehouseId, location, qty, itemId);
    insertIgnore(db, `INSERT INTO inventory_movements (folio, movement_type, item_id, quantity, to_warehouse_id, to_location_id, unit_cost, reason, reference, created_by)
      VALUES (?, 'entry', ?, ?, ?, ?, (SELECT standard_cost FROM items WHERE id = ?), 'Inventario inicial demo', 'PRECARGA-DEMO', ?) ON CONFLICT(folio) DO NOTHING`, `MOV-DEMO-${sku}`, itemId, qty, warehouseId, location, itemId, adminId);
  }

  const customerId = idBy(db, "customers", "code", "CLI-001");
  const productId = idBy(db, "items", "sku", "PT-EST01");
  insertIgnore(db, `INSERT INTO sales_documents
    (document_type, folio, customer_id, currency_id, issue_date, due_date, status, subtotal, tax_total, total, payment_terms_days, notes, created_by, approved_by)
    VALUES ('invoice', 'FAC-DEMO-0001', ?, ?, ?, ?, 'posted', 49500, 7920, 57420, 30, 'Factura ficticia para demostración', ?, ?)
    ON CONFLICT(folio) DO NOTHING`, customerId, mxn, isoDate(-8), isoDate(22), adminId, adminId);
  const invoiceId = idBy(db, "sales_documents", "folio", "FAC-DEMO-0001");
  insertIgnore(db, `INSERT INTO sales_document_lines
    (document_id, item_id, description, quantity, unit_price, tax_rate, subtotal, tax_amount, line_total, warehouse_id, location_id)
    VALUES (?, ?, 'Estación modular Nova', 10, 4950, 16, 49500, 7920, 57420, ?, ?) ON CONFLICT DO NOTHING`, invoiceId, productId, warehouseId, ptLocation);

  const directionEmployee = idBy(db, "employees", "employee_number", "E-00001");
  insertIgnore(db, `INSERT INTO finance_cost_centers (code, name, description, responsible_id, created_by)
    VALUES ('CC-OPER', 'Operación general', 'Centro de costo demostrativo', ?, ?) ON CONFLICT(code) DO NOTHING`, directionEmployee, adminId);
  const costCenterId = idBy(db, "finance_cost_centers", "code", "CC-OPER");
  insertIgnore(db, `INSERT INTO finance_receivables
    (folio, invoice_id, customer_id, currency_id, original_amount, paid_amount, issue_date, due_date, status, notes)
    VALUES ('CXC-DEMO-0001', ?, ?, ?, 57420, 20000, ?, ?, 'partial', 'Cuenta ficticia') ON CONFLICT(folio) DO NOTHING`, invoiceId, customerId, mxn, isoDate(-8), isoDate(22));
  const supplierId = idBy(db, "suppliers", "code", "PRO-001");
  insertIgnore(db, `INSERT INTO finance_payables
    (folio, supplier_id, cost_center_id, currency_id, invoice_reference, concept, category, original_amount, issue_date, due_date, status, notes, created_by)
    VALUES ('CXP-DEMO-0001', ?, ?, ?, 'FACT-DEMO-101', 'Compra de acero', 'Materia prima', 83520, ?, ?, 'pending', 'Cuenta ficticia', ?)
    ON CONFLICT(folio) DO NOTHING`, supplierId, costCenterId, mxn, isoDate(-5), isoDate(25), adminId);

  const prodArea = idBy(db, "areas", "code", "PROD");
  insertIgnore(db, `INSERT INTO resources (code, name, resource_type, area_id, description, capacity_per_hour, hourly_cost, currency_id)
    VALUES ('RES-CELDA-01', 'Celda de ensamble 01', 'work_center', ?, 'Recurso demo', 4, 650, ?) ON CONFLICT(code) DO NOTHING`, prodArea, mxn);
  const resourceId = idBy(db, "resources", "code", "RES-CELDA-01");
  insertIgnore(db, `INSERT INTO production_boms (folio, product_id, version, output_quantity, status, effective_from, notes, created_by)
    VALUES ('BOM-DEMO-001', ?, '1.0', 1, 'active', ?, 'Lista demo', ?) ON CONFLICT(folio) DO NOTHING`, productId, isoDate(-90), adminId);
  const bomId = idBy(db, "production_boms", "folio", "BOM-DEMO-001");
  for (const [sku, qty] of [["MP-ACERO", 2], ["MP-PINT", 0.4], ["MP-EMP", 1]])
    insertIgnore(db, `INSERT INTO production_bom_lines (bom_id, component_item_id, quantity, scrap_rate, notes)
      VALUES (?, ?, ?, 2, 'Consumo demo') ON CONFLICT(bom_id, component_item_id) DO NOTHING`, bomId, idBy(db, "items", "sku", sku), qty);
  insertIgnore(db, `INSERT INTO production_routes (folio, product_id, version, status, notes, created_by)
    VALUES ('RUT-DEMO-001', ?, '1.0', 'active', 'Ruta demo', ?) ON CONFLICT(folio) DO NOTHING`, productId, adminId);
  const routeId = idBy(db, "production_routes", "folio", "RUT-DEMO-001");
  for (const [sequence, name, setup, run] of [[10, "Corte y preparación", 30, 18], [20, "Ensamble", 15, 35], [30, "Inspección final", 5, 12]])
    insertIgnore(db, `INSERT INTO production_route_operations (route_id, sequence, name, resource_id, setup_minutes, run_minutes, instructions)
      VALUES (?, ?, ?, ?, ?, ?, 'Operación ficticia') ON CONFLICT(route_id, sequence) DO NOTHING`, routeId, sequence, name, resourceId, setup, run);
  insertIgnore(db, `INSERT INTO production_demands (folio, item_id, quantity, required_date, source, status, notes, created_by)
    VALUES ('DEM-DEMO-001', ?, 40, ?, 'forecast', 'planned', 'Demanda demo', ?) ON CONFLICT(folio) DO NOTHING`, productId, isoDate(14), adminId);
  const demandId = idBy(db, "production_demands", "folio", "DEM-DEMO-001");
  insertIgnore(db, `INSERT INTO production_orders
    (folio, demand_id, item_id, bom_id, route_id, warehouse_id, planned_quantity, produced_quantity, status, scheduled_start, scheduled_end, notes, created_by)
    VALUES ('OP-DEMO-001', ?, ?, ?, ?, ?, 40, 12, 'in_progress', ?, ?, 'Orden demo', ?) ON CONFLICT(folio) DO NOTHING`, demandId, productId, bomId, routeId, warehouseId, isoDate(), isoDate(5), adminId);

  insertIgnore(db, `INSERT INTO quality_inspection_plans
    (folio, name, inspection_type, item_id, sample_size, acceptance_limit, notes, created_by)
    VALUES ('PC-DEMO-001', 'Liberación estación Nova', 'final', ?, 5, 0, 'Plan demo', ?) ON CONFLICT(folio) DO NOTHING`, productId, adminId);
  const qualityPlanId = idBy(db, "quality_inspection_plans", "folio", "PC-DEMO-001");
  insertIgnore(db, `INSERT INTO quality_plan_checks (plan_id, sequence, characteristic, check_type, min_value, max_value, unit)
    VALUES (?, 10, 'Dimensión general', 'numeric', 998, 1002, 'mm') ON CONFLICT(plan_id, sequence) DO NOTHING`, qualityPlanId);

  const maintenanceArea = idBy(db, "areas", "code", "MANT");
  insertIgnore(db, `INSERT INTO maintenance_equipment
    (folio, resource_id, name, category, manufacturer, model, serial_number, area_id, physical_location, criticality, meter_type, meter_value, acquisition_date, notes, created_by)
    VALUES ('EQ-DEMO-001', ?, 'Prensa hidráulica 80 T', 'Prensa', 'Demo Machines', 'PH-80', 'SN-DEMO-001', ?, 'Nave 1', 'high', 'hours', 4280, ?, 'Equipo ficticio', ?)
    ON CONFLICT(folio) DO NOTHING`, resourceId, maintenanceArea, isoDate(-1460), adminId);
  const equipmentId = idBy(db, "maintenance_equipment", "folio", "EQ-DEMO-001");
  insertIgnore(db, `INSERT INTO maintenance_plans
    (folio, equipment_id, name, frequency_type, frequency_value, next_due_date, estimated_hours, instructions, created_by)
    VALUES ('PM-DEMO-001', ?, 'Mantenimiento mensual', 'months', 1, ?, 4, 'Inspección, lubricación y prueba funcional', ?) ON CONFLICT(folio) DO NOTHING`, equipmentId, isoDate(12), adminId);

  insertIgnore(db, `INSERT INTO logistics_carriers (code, name, contact_name, phone, email, service_type, vehicle_type, notes, created_by)
    VALUES ('TRANS-DEMO', 'Transportes Demo del Norte', 'Contacto Demo', '8100000000', 'logistica@example.com', 'national', 'Camión 3.5 t', 'Proveedor ficticio', ?)
    ON CONFLICT(code) DO NOTHING`, adminId);
  const carrierId = idBy(db, "logistics_carriers", "code", "TRANS-DEMO");
  insertIgnore(db, `INSERT INTO logistics_routes
    (folio, name, carrier_id, route_date, driver_name, vehicle_plate, origin, destination, status, notes, created_by)
    VALUES ('RUTA-DEMO-001', 'Monterrey - Querétaro', ?, ?, 'Conductor Demo', 'DEMO-01', 'Monterrey', 'Querétaro', 'planned', 'Ruta ficticia', ?)
    ON CONFLICT(folio) DO NOTHING`, carrierId, isoDate(2), adminId);

  insertIgnore(db, `INSERT INTO workflow_tasks
    (folio, title, description, module, entity_type, entity_id, assigned_to, priority, status, due_date, created_by)
    VALUES ('TAR-DEMO-001', 'Aprobar compra de materia prima', 'Tarea ficticia para mostrar el flujo de aprobación', 'purchases', 'purchase_request', 'DEMO', ?, 'high', 'pending', ?, ?)
    ON CONFLICT(folio) DO NOTHING`, adminId, isoDate(3), adminId);
  const employeeId = idBy(db, "employees", "employee_number", "E-00017");
  insertIgnore(db, `INSERT INTO safety_incidents
    (folio, employee_id, area_id, event_type, event_date, location, description, immediate_action, severity, lost_time, status, reported_by)
    VALUES ('SST-DEMO-001', ?, ?, 'near_miss', ?, 'Nave 1', 'Casi incidente ficticio por material fuera de ubicación', 'Asegurar y señalizar el área', 'low', 0, 'investigating', ?)
    ON CONFLICT(folio) DO NOTHING`, employeeId, prodArea, isoDate(-4), adminId);
}

function seedHumanResources(db) {
  const adminId = idBy(db, "users", "username", "demo.admin");
  const rhUserId = idBy(db, "users", "username", "demo.rh");
  const managerId = idBy(db, "employees", "employee_number", "E-00009");
  const vacationEmployee = idBy(db, "employees", "employee_number", "E-00011");
  const permissionEmployee = idBy(db, "employees", "employee_number", "E-00012");
  insertIgnore(db, `INSERT INTO hr_holidays (holiday_date, name, created_by)
    VALUES (?, 'Día festivo demo', ?) ON CONFLICT(holiday_date) DO NOTHING`, isoDate(20), rhUserId);
  insertIgnore(db, `INSERT INTO hr_leave_requests
    (folio, employee_id, leave_type, subtype, start_date, end_date, total_days, total_hours, reason, status,
     created_by, approved_by, vacation_applied, request_origin, current_approval_step, coverage_employee_id, working_days)
    VALUES ('VAC-DEMO-001', ?, 'vacation', 'Periodo ordinario', ?, ?, 3, 0, 'Descanso programado de demostración', 'approved',
      ?, ?, 1, 'erp', 'completed', ?, 3) ON CONFLICT(folio) DO NOTHING`, vacationEmployee, isoDate(8), isoDate(10), rhUserId, rhUserId, permissionEmployee);
  const vacationId = idBy(db, "hr_leave_requests", "folio", "VAC-DEMO-001");
  insertIgnore(db, `INSERT INTO hr_leave_workflow_steps
    (leave_request_id, step_order, step_type, status, assigned_employee_id, decided_by_employee_id, decided_by_user_id, decision_reason, decided_at)
    VALUES (?, 1, 'manager', 'approved', ?, ?, ?, 'Cobertura disponible', CURRENT_TIMESTAMP) ON CONFLICT(leave_request_id, step_order) DO NOTHING`, vacationId, managerId, managerId, rhUserId);
  insertIgnore(db, `INSERT INTO hr_leave_workflow_steps
    (leave_request_id, step_order, step_type, status, decided_by_user_id, decision_reason, decided_at)
    VALUES (?, 2, 'hr', 'approved', ?, 'Saldo y cobertura validados', CURRENT_TIMESTAMP) ON CONFLICT(leave_request_id, step_order) DO NOTHING`, vacationId, rhUserId);
  insertIgnore(db, `INSERT INTO hr_leave_status_history
    (leave_request_id, previous_status, new_status, action, actor_type, actor_user_id, comments)
    VALUES (?, 'submitted', 'approved', 'approved', 'hr', ?, 'Solicitud demo aprobada')`, vacationId, rhUserId);
  insertIgnore(db, `INSERT INTO hr_vacation_balance_movements
    (employee_id, leave_request_id, movement_type, days, balance_before, balance_after, debt_before, debt_after, created_by, notes)
    VALUES (?, ?, 'consumption', -3, 15, 12, 0, 0, ?, 'Movimiento demo')`, vacationEmployee, vacationId, rhUserId);
  db.prepare("UPDATE hr_employee_profiles SET vacation_balance = 12 WHERE employee_id = ?").run(vacationEmployee);

  insertIgnore(db, `INSERT INTO hr_leave_requests
    (folio, employee_id, leave_type, subtype, start_date, end_date, total_days, total_hours, reason, status,
     created_by, request_origin, current_approval_step, is_unpaid, unpaid_terms_accepted, working_days)
    VALUES ('PER-DEMO-001', ?, 'permission', 'Asunto personal', ?, ?, 1, 0, 'Permiso ficticio pendiente', 'submitted',
      ?, 'portal', 'manager', 0, 0, 1) ON CONFLICT(folio) DO NOTHING`, permissionEmployee, isoDate(5), isoDate(5), rhUserId);

  const start = mondayForCurrentWeek();
  insertIgnore(db, `INSERT INTO hr_schedule_periods (start_date, end_date, status, created_by)
    VALUES (?, ?, 'active', ?) ON CONFLICT(start_date) DO NOTHING`, start, addDays(start, 6), rhUserId);
  const period = db.prepare("SELECT id FROM hr_schedule_periods WHERE start_date = ? AND end_date = ?").get(start, addDays(start, 6));
  insertIgnore(db, `INSERT INTO hr_schedule_versions (period_id, version_number, status, source, notes, created_by, published_by, published_at)
    VALUES (?, 1, 'published', 'default_shift', 'Horario demo generado automáticamente', ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(period_id, version_number) DO NOTHING`, period.id, rhUserId, rhUserId);
  const versionId = db.prepare("SELECT id FROM hr_schedule_versions WHERE period_id = ? AND version_number = 1").get(period.id).id;
  const dayShift = db.prepare("SELECT id FROM hr_work_shifts WHERE code = 'DAY'").get()?.id
    ?? db.prepare("SELECT id FROM hr_work_shifts ORDER BY id LIMIT 1").get()?.id ?? null;
  for (const employee of db.prepare("SELECT id FROM employees WHERE status = 'active' ORDER BY id").all())
    for (let day = 0; day < 7; day++)
      insertIgnore(db, `INSERT INTO hr_scheduled_shifts
        (schedule_version_id, employee_id, work_date, start_time, end_time, break_minutes, work_shift_id, is_day_off, notes)
        VALUES (?, ?, ?, ?, ?, 60, ?, ?, ?) ON CONFLICT(schedule_version_id, employee_id, work_date) DO NOTHING`,
      versionId, employee.id, addDays(start, day), day < 5 ? "08:00" : null, day < 5 ? "17:00" : null, dayShift, day < 5 ? 0 : 1, day < 5 ? "Turno automático demo" : "Descanso");

  const periodCode = `Q-DEMO-${isoDate().slice(0, 7)}`;
  insertIgnore(db, `INSERT INTO payroll_periods (code, frequency, start_date, end_date, payment_date, status, notes, created_by)
    VALUES (?, 'biweekly', ?, ?, ?, 'open', 'Periodo ficticio de demostración', ?) ON CONFLICT(code) DO NOTHING`, periodCode, isoDate(-14), isoDate(), isoDate(2), rhUserId);
  const payrollPeriodId = idBy(db, "payroll_periods", "code", periodCode);
  insertIgnore(db, `INSERT INTO payroll_preparations (period_id, status, created_by)
    VALUES (?, 'draft', ?) ON CONFLICT(period_id) DO NOTHING`, payrollPeriodId, rhUserId);
  const preparationId = db.prepare("SELECT id FROM payroll_preparations WHERE period_id = ?").get(payrollPeriodId).id;
  for (const employee of db.prepare(`SELECT e.id, c.base_salary FROM employees e
    JOIN hr_employee_compensation_private c ON c.employee_id = e.id WHERE e.status = 'active'`).all()) {
    const basePay = Math.round((Number(employee.base_salary) / 2) * 100) / 100;
    const tax = Math.round(basePay * 0.12 * 100) / 100;
    const social = Math.round(basePay * 0.035 * 100) / 100;
    insertIgnore(db, `INSERT INTO payroll_preparation_lines
      (preparation_id, employee_id, base_pay, other_perceptions, tax_deduction, social_security_deduction,
       gross_pay, total_deductions, net_pay, notes, updated_by)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, 'Cálculo ficticio; no usar para pago real', ?)
      ON CONFLICT(preparation_id, employee_id) DO NOTHING`, preparationId, employee.id, basePay, tax, social,
    basePay, tax + social, basePay - tax - social, adminId);
  }
}

export function seedDemoCompany(db, { company } = {}) {
  const marker = db.prepare("SELECT value FROM app_settings WHERE key = 'demo_company_seed_version'").get()?.value;
  if (marker === DEMO_SEED_VERSION) return demoSummary(db, true);
  const companyId = db.prepare("SELECT value FROM app_settings WHERE key = 'managed_company_id'").get()?.value
    ?? company?.id;
  if (!companyId) throw new Error("La empresa demo debe estar sincronizada antes de precargar sus datos.");
  try {
    db.exec("BEGIN IMMEDIATE");
    seedOrganization(db, Number(companyId));
    seedEmployees(db, Number(companyId));
    seedCatalogsAndOperations(db);
    seedHumanResources(db);
    insertIgnore(db, `INSERT INTO app_settings (key, value, value_type, description)
      VALUES ('demo_company_seed_version', ?, 'string', 'Versión de la precarga ficticia de demostración')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`, DEMO_SEED_VERSION);
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
  return demoSummary(db, false);
}

function demoSummary(db, alreadySeeded) {
  const count = (table) => Number(db.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get().value || 0);
  return {
    alreadySeeded,
    seedVersion: DEMO_SEED_VERSION,
    employees: count("employees"),
    users: count("users"),
    areas: count("areas"),
    workCenters: count("hr_work_centers"),
    positions: count("hr_job_positions"),
    items: count("items"),
    customers: count("customers"),
    suppliers: count("suppliers"),
    payrollLines: count("payroll_preparation_lines"),
  };
}
