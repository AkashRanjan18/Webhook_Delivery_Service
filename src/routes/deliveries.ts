import type { FastifyInstance } from "fastify";
import { listDead, replayDelivery } from "../repository.js";

export async function deliveryRoutes(app: FastifyInstance) {
  app.get("/deliveries/dead", async () => {
    const rows = await listDead(100);
    return { deliveries: rows };
  });

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
