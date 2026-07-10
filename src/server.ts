import { config } from "./config.js";
import { pool } from "./db.js";
import { buildApp } from "./app.js";

const app = await buildApp();

async function shutdown(signal: string) {
  app.log.info(`${signal} received, shutting down …`);
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
