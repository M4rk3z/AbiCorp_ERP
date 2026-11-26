# Abicorp ERP

Consulta [RUTAS.txt](RUTAS.txt) para encontrar las pantallas, las rutas de la API
y los archivos que corresponden a cada módulo.

## ERP local

Desde la raíz del proyecto, con Node.js 24 y pnpm 10:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Abre http://127.0.0.1:5050. El servidor usa SQLite local por defecto.
El Portal del colaborador está en http://127.0.0.1:5050/portal.

La configuración de PostgreSQL está en [POSTGRESQL.md](POSTGRESQL.md).
El Centro de Gestión se inicia por separado y requiere su copia local.
