import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import type { DbPool } from "./db/pool.js";
import { createDbPool } from "./db/pool.js";
import { AppError } from "./errors.js";
import { createNoopRealtimeHub, type RealtimeHub } from "./realtime/realtime-hub.js";
import { registerAuctionRoutes } from "./routes/auctions-routes.js";
import { registerDemoRoutes } from "./routes/demo-routes.js";
import { registerOrderRoutes } from "./routes/orders-routes.js";
import { registerProductRoutes } from "./routes/products-routes.js";
import { createRedisBidCoordinator, type BidCoordinator } from "./services/bid-coordinator.js";

interface CreateAppOptions {
  pool?: DbPool;
  logger?: boolean;
  realtimeHub?: RealtimeHub;
  bidCoordinator?: BidCoordinator;
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false
  });

  const pool = options.pool ?? createDbPool();
  const ownsPool = !options.pool;
  const realtimeHub = options.realtimeHub ?? createNoopRealtimeHub();
  const bidCoordinator = options.bidCoordinator ?? createRedisBidCoordinator();

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message
        }
      });
    }

    if (error.validation) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: error.message
        }
      });
    }

    requestLog(app, error);
    return reply.status(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unexpected server error."
      }
    });
  });

  app.get("/health", async () => {
    return {
      ok: true,
      service: "live-auction-api",
      time: new Date().toISOString()
    };
  });

  await registerProductRoutes(app, pool);
  await registerAuctionRoutes(app, pool, realtimeHub, bidCoordinator);
  await registerOrderRoutes(app, pool, realtimeHub);
  await registerDemoRoutes(app, pool);

  if (ownsPool) {
    app.addHook("onClose", async () => {
      await pool.end();
    });
  }

  return app;
}

function requestLog(app: FastifyInstance, error: Error): void {
  if (app.log) {
    app.log.error(error);
  }
}
