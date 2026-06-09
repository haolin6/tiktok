import type { FastifyInstance } from "fastify";
import type { CreateProductRequest, CreateProductResponse } from "@live-auction/shared";
import type { DbPool } from "../db/pool.js";
import { createProduct } from "../services/products-service.js";

export async function registerProductRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.post<{ Body: CreateProductRequest; Reply: CreateProductResponse }>(
    "/api/products",
    {
      schema: {
        body: {
          type: "object",
          required: ["title"],
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 160 },
            imageUrl: { type: ["string", "null"], maxLength: 512 },
            description: { type: ["string", "null"] },
            createdBy: { type: "integer", minimum: 1 }
          }
        }
      }
    },
    async (request) => {
      const product = await createProduct(pool, request.body);
      return { product };
    }
  );
}
