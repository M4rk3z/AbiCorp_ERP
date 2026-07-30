export const moduleCatalog = [
  { key: "dashboard", label: "Dashboards", description: "Panel principal y atajos personales", symbol: "⌂", permissionModules: ["dashboard"] },
  { key: "core", label: "Núcleo operativo", description: "Catálogos, folios, documentos y notificaciones", symbol: "◇", permissionModules: ["areas", "catalogs", "folios", "documents", "notifications"] },
  { key: "masters", label: "Datos maestros", description: "Artículos, clientes, proveedores, personal y recursos", symbol: "▦", permissionModules: ["masters"] },
  { key: "inventory", label: "Almacén", description: "Existencias y movimientos de inventario", symbol: "▤", permissionModules: ["inventory"] },
  { key: "purchases", label: "Compras", description: "Solicitudes, órdenes y recepción", symbol: "↘", permissionModules: ["purchases"] },
  { key: "sales", label: "Ventas", description: "Prospectos, pedidos, entrega y facturación", symbol: "↗", permissionModules: ["sales"] },
  { key: "production", label: "Producción", description: "Ingeniería, órdenes de trabajo y ejecución", symbol: "⚒", permissionModules: ["production"] },
  { key: "quality", label: "Calidad", description: "Inspecciones, liberaciones y acciones", symbol: "✓", permissionModules: ["quality"] },
  { key: "maintenance", label: "Mantenimiento", description: "Equipos, programa anual, OT y costos", symbol: "⚙", permissionModules: ["maintenance"] },
  { key: "logistics", label: "Logística", description: "Preparación, embarque y entrega", symbol: "⇢", permissionModules: ["logistics"] },
  { key: "finance", label: "Finanzas", description: "Ingresos, egresos, presupuestos y conciliación", symbol: "$", permissionModules: ["finance"] },
  { key: "tasks", label: "Tareas y aprobaciones", description: "Pendientes, flujos y decisiones", symbol: "●", permissionModules: ["tasks", "workflow"] },
  { key: "safety", label: "Seguridad y salud", description: "Riesgos, incidentes y cumplimiento", symbol: "✚", permissionModules: ["safety"] },
  { key: "hr", label: "Recursos humanos", description: "Personal, permisos, vacaciones y asistencia", symbol: "♙", permissionModules: ["hr"] },
  { key: "system", label: "Supervisión del sistema", description: "Configuración y bitácora", symbol: "◉", permissionModules: ["settings", "audit"] },
];

const moduleByKey = new Map(moduleCatalog.map((module) => [module.key, module]));

export function normalizeModuleAccess(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Map();
  for (const entry of value) {
    const key = String(entry?.key ?? entry?.moduleKey ?? "");
    const level = Number(entry?.level ?? entry?.accessLevel);
    if (!moduleByKey.has(key) || !Number.isInteger(level) || level < 1 || level > 4) continue;
    unique.set(key, { key, level });
  }
  return [...unique.values()];
}

export function replaceUserModuleAccess(db, userId, access) {
  const normalized = normalizeModuleAccess(access);
  if (normalized.length && !normalized.some((entry) => entry.key === "dashboard"))
    normalized.unshift({ key: "dashboard", level: 1 });
  db.prepare("DELETE FROM user_module_access WHERE user_id = ?").run(userId);
  const insert = db.prepare(`INSERT INTO user_module_access (user_id, module_key, access_level)
    VALUES (?, ?, ?)`);
  for (const entry of normalized) insert.run(userId, entry.key, entry.level);
  return normalized;
}

export function explicitModuleAccess(db, userId) {
  return db.prepare(`SELECT module_key AS key, access_level AS level
    FROM user_module_access WHERE user_id = ? ORDER BY module_key`).all(userId);
}

export function effectiveModuleAccess(db, userId) {
  const direct = explicitModuleAccess(db, userId);
  if (direct.length) return direct;
  const rolePermissions = db.prepare(`SELECT DISTINCT p.module, p.min_level
    FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    JOIN user_roles ur ON ur.role_id = rp.role_id
    WHERE ur.user_id = ?`).all(userId);
  const result = [];
  for (const module of moduleCatalog) {
    const matches = rolePermissions.filter((permission) => module.permissionModules.includes(permission.module));
    if (matches.length) result.push({ key: module.key, level: Math.max(...matches.map((permission) => Number(permission.min_level))) });
  }
  return result;
}

export function permissionsForUser(db, userId) {
  const codes = new Set(db.prepare(`SELECT DISTINCT p.code FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    JOIN user_roles ur ON ur.role_id = rp.role_id
    WHERE ur.user_id = ?`).all(userId).map((row) => row.code));
  for (const access of explicitModuleAccess(db, userId)) {
    const module = moduleByKey.get(access.key);
    if (!module) continue;
    const placeholders = module.permissionModules.map(() => "?").join(", ");
    const rows = db.prepare(`SELECT code FROM permissions
      WHERE module IN (${placeholders}) AND min_level <= ?`).all(...module.permissionModules, access.level);
    for (const row of rows) codes.add(row.code);
  }
  return [...codes].sort();
}
