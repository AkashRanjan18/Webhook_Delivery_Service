import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

interface CreateMessageBody {
  endpoint_id: string;
  payload: Record<string, unknown>;
}

export async function messageRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateMessageBody }>(
    "/messages",
    {
      schema: {
        body: {
          type: "object",
          required: ["endpoint_id", "payload"],
          properties: {
            endpoint_id: { type: "string", minLength: 1 },
            payload: { type: "object" },
          },
        },
      },
    },
    async (request, reply) => {
      const { endpoint_id, payload } = request.body;

      const header = request.headers["idempotency-key"];
      const idempotencyKey = typeof header === "string" ? header : null;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const msg = await client.query<{ id: string }>(
          `INSERT INTO messages (endpoint_id, payload, idempotency_key)
           VALUES ($1, $2, $3)
           ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
           RETURNING id`,
          [endpoint_id, payload, idempotencyKey],
        );

        if (msg.rows.length > 0) {
          const messageId = msg.rows[0].id;
          await client.query(
            "INSERT INTO deliveries (message_id) VALUES ($1)",
            [messageId],
          );
          await client.query("COMMIT");
          return reply.code(202).send({ message_id: messageId });
        }

        const existing = await client.query<{ id: string }>(
          "SELECT id FROM messages WHERE idempotency_key = $1",
          [idempotencyKey],
        );
        await client.query("COMMIT");
        return reply.code(202).send({ message_id: existing.rows[0].id });
      } catch (err) {
        await client.query("ROLLBACK");
        request.log.error(err, "failed to enqueue message");
        return reply.code(500).send({ error: "failed to enqueue message" });
      } finally {
        client.release();
      }
    },
  );
}