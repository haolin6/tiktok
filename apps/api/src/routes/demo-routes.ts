import type { FastifyInstance } from "fastify";
import type { DemoContextResponse } from "@live-auction/shared";
import type { DbPool } from "../db/pool.js";
import { getDemoContext } from "../services/demo-service.js";

export async function registerDemoRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get<{ Reply: DemoContextResponse }>("/api/demo/context", async () => {
    return getDemoContext(pool);
  });
}
