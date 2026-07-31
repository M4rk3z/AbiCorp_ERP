import { createServer } from "node:http";
import { createApplication } from "./app.js";

// Render asigna PORT en cada servicio. ERP_PORT conserva la configuración local.
const port = Number(process.env.PORT ?? process.env.ERP_PORT ?? 5050);
const host = process.env.ERP_HOST ?? (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
const app = createApplication();
const server = createServer(app.handle);

server.listen(port, host, () => {
  console.log(`Abicorp ERP disponible en http://${host}:${port}`);
  console.log(`Base de datos: ${app.dbPath}`);
});

function shutdown() {
  server.close(() => {
    app.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
