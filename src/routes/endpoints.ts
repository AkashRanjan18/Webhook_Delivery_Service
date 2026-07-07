import type { FastifyInstance } from "fastify";
import { query } from "../db.js";

interface CreateEndpointBody{
    url: string,
    secret: string,
}
export async function endpointRoutes(app: FastifyInstance){
    app.post<{Body: CreateEndpointBody}>("/endpoints",
    { schema:{
        body:{
            type: "object",
            required: ["url", "secret"],
            properties:{
                url: {type: "string", minLength: 1 },
                secret: {type: "string", minLength: 1},
            },
        },
    },
},
async(request , reply ) => {
    const {url, secret} = request.body;
       const result = await query<{ id: string }>(
        "INSERT INTO endpoints (url, secret) VALUES ($1, $2) RETURNING id",
        [url, secret],
      );

      return reply.code(201).send({ id: result.rows[0].id });
}
)
}
