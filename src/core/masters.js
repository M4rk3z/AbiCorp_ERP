export const masterDefinitions = {
  items: {
    table: "items",
    autoCode: { field: "sku", source: "item_type", prefixes: { finished: "PT-", raw_material: "MP-", consumable: "CON-", tool: "HER-", service: "SER-", asset: "ACT-" } },
    label: "Artículo",
    select: `SELECT i.id, i.sku, i.name, i.item_type, i.description, i.unit_id, i.currency_id,
      i.standard_cost, i.list_price, i.tax_rate, i.min_stock, i.max_stock, i.inventory_tracked,
      i.purchase_enabled, i.sales_enabled, i.production_enabled, i.is_active, i.created_at, i.updated_at,
      u.code AS unit_code, u.symbol AS unit_symbol, c.code AS currency_code
      FROM items i LEFT JOIN units_of_measure u ON u.id = i.unit_id
      LEFT JOIN currencies c ON c.id = i.currency_id ORDER BY i.name`,
    fields: {
      sku: { type: "code", required: true, max: 60 },
      name: { type: "text", required: true, max: 180 },
      item_type: { type: "enum", required: true, values: ["finished", "raw_material", "consumable", "tool", "service", "asset"] },
      description: { type: "text", max: 1000, default: "" },
      unit_id: { type: "nullable_id", default: null },
      currency_id: { type: "nullable_id", default: null },
      standard_cost: { type: "number", min: 0, default: 0 },
      list_price: { type: "number", min: 0, default: 0 },
      tax_rate: { type: "number", min: 0, maxValue: 100, default: 0 },
      min_stock: { type: "number", min: 0, default: 0 },
      max_stock: { type: "number", min: 0, default: 0 },
      inventory_tracked: { type: "boolean", default: 1 },
      purchase_enabled: { type: "boolean", default: 1 },
      sales_enabled: { type: "boolean", default: 0 },
      production_enabled: { type: "boolean", default: 0 },
      is_active: { type: "boolean", default: 1 },
    },
  },
  customers: {
    table: "customers",
    autoCode: { field: "code", prefix: "CLI-" },
    label: "Cliente",
    select: `SELECT c.id, c.code, c.legal_name, c.trade_name, c.tax_id, c.email, c.phone, c.address,
      c.currency_id, c.credit_limit, c.payment_terms_days, c.is_active, c.created_at, c.updated_at,
      m.code AS currency_code FROM customers c LEFT JOIN currencies m ON m.id = c.currency_id ORDER BY c.legal_name`,
    fields: partyFields({ credit_limit: { type: "number", min: 0, default: 0 } }),
  },
  suppliers: {
    table: "suppliers",
    autoCode: { field: "code", prefix: "PRV-" },
    label: "Proveedor",
    select: `SELECT s.id, s.code, s.legal_name, s.trade_name, s.tax_id, s.email, s.phone, s.address,
      s.currency_id, s.payment_terms_days, s.lead_time_days, s.is_active, s.created_at, s.updated_at,
      m.code AS currency_code FROM suppliers s LEFT JOIN currencies m ON m.id = s.currency_id ORDER BY s.legal_name`,
    fields: partyFields({ lead_time_days: { type: "integer", min: 0, default: 0 } }),
  },
  employees: {
    table: "employees",
    autoCode: { field: "employee_number", prefix: "E-" },
    label: "Empleado",
    readOnly: true,
    select: `SELECT e.id, e.employee_number, e.full_name, e.email, e.phone, e.area_id, e.position,
      e.position_id, e.hire_date, e.status, e.created_at, e.updated_at, a.name AS area_name,
      p.employment_type, p.work_schedule, p.vacation_balance, p.photo_filename,
      p.contract_end_date, p.organization_name, p.organization_details, p.organization_contact_name,
      p.organization_contact_phone, p.organization_contact_email, p.advisor_name, p.advisor_phone,
      p.advisor_email, p.service_start_date, p.service_end_date, p.required_service_hours,
      jp.name AS job_position_name, ws.name AS shift_name, ws.start_time AS shift_start_time,
      ws.end_time AS shift_end_time, ws.work_days AS shift_work_days, ws.schedule_json AS shift_schedule_json,
      vp.name AS vacation_plan_name, vp.annual_days AS vacation_plan_days
      FROM employees e
      LEFT JOIN areas a ON a.id = e.area_id
      LEFT JOIN hr_employee_profiles p ON p.employee_id = e.id
      LEFT JOIN hr_job_positions jp ON jp.id = e.position_id
      LEFT JOIN hr_work_shifts ws ON ws.id = p.work_shift_id
      LEFT JOIN hr_vacation_plans vp ON vp.id = p.vacation_plan_id
      ORDER BY e.full_name`,
    fields: {
      employee_number: { type: "code", required: true, max: 40 },
      full_name: { type: "text", required: true, max: 180 },
      email: { type: "email", max: 180, default: "" },
      phone: { type: "text", max: 40, default: "" },
      area_id: { type: "nullable_id", default: null },
      position: { type: "text", max: 120, default: "" },
      hire_date: { type: "date", default: null },
      status: { type: "enum", required: true, values: ["active", "inactive", "leave"], default: "active" },
    },
  },
  resources: {
    table: "resources",
    autoCode: { field: "code", source: "resource_type", prefixes: { machine: "MAQ-", work_center: "CT-", tool: "HER-", personnel: "PER-" } },
    label: "Recurso",
    select: `SELECT r.id, r.code, r.name, r.resource_type, r.area_id, r.employee_id, r.description,
      r.capacity_per_hour, r.hourly_cost, r.currency_id, r.status, r.created_at, r.updated_at,
      a.name AS area_name, e.full_name AS employee_name, c.code AS currency_code
      FROM resources r LEFT JOIN areas a ON a.id = r.area_id
      LEFT JOIN employees e ON e.id = r.employee_id LEFT JOIN currencies c ON c.id = r.currency_id
      ORDER BY r.name`,
    fields: {
      code: { type: "code", required: true, max: 60 },
      name: { type: "text", required: true, max: 180 },
      resource_type: { type: "enum", required: true, values: ["machine", "work_center", "tool", "personnel"] },
      area_id: { type: "nullable_id", default: null },
      employee_id: { type: "nullable_id", default: null },
      description: { type: "text", max: 1000, default: "" },
      capacity_per_hour: { type: "number", min: 0, default: 0 },
      hourly_cost: { type: "number", min: 0, default: 0 },
      currency_id: { type: "nullable_id", default: null },
      status: { type: "enum", required: true, values: ["available", "maintenance", "inactive"], default: "available" },
    },
  },
  price_lists: {
    table: "price_lists",
    autoCode: { field: "code", source: "list_type", prefixes: { sale: "LPV-", cost: "LPC-" } },
    label: "Lista de precios o costos",
    select: `SELECT p.id, p.code, p.name, p.list_type, p.currency_id, p.valid_from, p.valid_to,
      p.is_active, p.created_at, p.updated_at, c.code AS currency_code, COUNT(pi.id) AS items_count
      FROM price_lists p JOIN currencies c ON c.id = p.currency_id
      LEFT JOIN price_list_items pi ON pi.price_list_id = p.id GROUP BY p.id ORDER BY p.name`,
    fields: {
      code: { type: "code", required: true, max: 40 },
      name: { type: "text", required: true, max: 140 },
      list_type: { type: "enum", required: true, values: ["sale", "cost"] },
      currency_id: { type: "id", required: true },
      valid_from: { type: "date", default: null },
      valid_to: { type: "date", default: null },
      is_active: { type: "boolean", default: 1 },
    },
  },
};

function partyFields(extra) {
  return {
    code: { type: "code", required: true, max: 40 },
    legal_name: { type: "text", required: true, max: 180 },
    trade_name: { type: "text", max: 180, default: "" },
    tax_id: { type: "text", max: 30, default: "" },
    email: { type: "email", max: 180, default: "" },
    phone: { type: "text", max: 40, default: "" },
    address: { type: "text", max: 600, default: "" },
    currency_id: { type: "nullable_id", default: null },
    payment_terms_days: { type: "integer", min: 0, default: 0 },
    ...extra,
    is_active: { type: "boolean", default: 1 },
  };
}
