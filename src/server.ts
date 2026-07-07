
import Fastify from "fastify";
import { config } from "./config.js";
import { pool } from "./db.js";
import { endpointRoutes } from "./routes/endpoints.js";
import { messageRoutes } from "./routes/messages.js";

const app = Fastify({ logger: true });

app.get("/health", async () => (
     { ok: true }
));

await app.register(endpointRoutes);
await app.register(messageRoutes);

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
