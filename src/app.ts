import Fastify from "fastify";
import { endpointRoutes } from "./routes/endpoints.js";
import { messageRoutes } from "./routes/messages.js";
import { deliveryRoutes } from "./routes/deliveries.js";

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true });

  app.get("/health", async () => ({ ok: true }));

  await app.register(endpointRoutes);
  await app.register(messageRoutes);
  await app.register(deliveryRoutes);

  return app;
}
