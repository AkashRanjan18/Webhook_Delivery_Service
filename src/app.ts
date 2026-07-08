import Fastify from "fastify";
import { endpointRoutes } from "./routes/endpoints.js";
import { messageRoutes } from "./routes/messages.js";
import { deliveryRoutes } from "./routes/deliveries.js";

// Builds the Fastify app with all routes registered, but does NOT listen.
// server.ts uses it to run for real; tests use it with app.inject() (no port).
export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true });

  app.get("/health", async () => ({ ok: true }));

  await app.register(endpointRoutes);
  await app.register(messageRoutes);
  await app.register(deliveryRoutes);

  return app;
}
