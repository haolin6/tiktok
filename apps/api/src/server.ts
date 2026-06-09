import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { createDbPool } from "./db/pool.js";
import { createRealtimeHub } from "./realtime/realtime-hub.js";
import { createRedisClient } from "./repositories/redis-client.js";
import { createRedisBidCoordinator } from "./services/bid-coordinator.js";

const pool = createDbPool();
const redis = createRedisClient();
await redis.connect();
const bidCoordinator = createRedisBidCoordinator(redis);
const realtimeHub = createRealtimeHub(pool, { redis, bidCoordinator });
const app = await createApp({
  pool,
  realtimeHub,
  bidCoordinator,
  logger: env.nodeEnv !== "test"
});
realtimeHub.attach(app.server);
app.addHook("onClose", async () => {
  await realtimeHub.close();
  await pool.end();
});

try {
  await app.listen({
    host: "0.0.0.0",
    port: env.apiPort
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
