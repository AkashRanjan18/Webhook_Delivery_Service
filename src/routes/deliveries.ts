import type { FastifyInstance } from "fastify";
import { listDead, replayDelivery } from "../repository.js";

export async function deliveryRoutes(app: FastifyInstance) {
  // List the dead-letter queue (deliveries the worker gave up on).
  app.get("/deliveries/dead", async () => {
    const rows = await listDead(100);
    return { deliveries: rows };
  });

  // Re-queue one dead delivery for a fresh set of attempts.
  app.post<{ Params: { id: string } }>(
    "/deliveries/:id/replay",
    async (request, reply) => {
      const { id } = request.params;
      const replayed = await replayDelivery(id);

      if (!replayed) {
        return reply.code(404).send({ error: "not found or not dead" });
      }
      return reply.code(200).send({ replayed: true, id });
    },
  );
}
