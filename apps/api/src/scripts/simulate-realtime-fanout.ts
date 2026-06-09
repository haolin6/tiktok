import type { FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";
import type { RowDataPacket } from "mysql2";
import { io, type Socket } from "socket.io-client";
import type { AuctionDto, PlaceBidResponse, RealtimeAck } from "@live-auction/shared";
import { createApp } from "../app.js";
import { createDbPool } from "../db/pool.js";
import type { DbPool } from "../db/pool.js";
import { createRealtimeHub, type RealtimeHub } from "../realtime/realtime-hub.js";
import { createRedisClient, type RedisCommandClient } from "../repositories/redis-client.js";
import { findDemoRoom } from "../repositories/rooms-repository.js";
import { createAuction, startAuction } from "../services/auctions-service.js";
import { createRedisBidCoordinator, type BidCoordinator } from "../services/bid-coordinator.js";
import { createProduct } from "../services/products-service.js";

interface IdRow extends RowDataPacket {
  id: number;
}

type Pool = ReturnType<typeof createDbPool>;

const DEFAULT_CLIENTS = 100;

function parseClients(): number {
  const rawValue = process.argv
    .find((arg) => arg.startsWith("--clients="))
    ?.slice("--clients=".length);
  const clients = rawValue === undefined ? DEFAULT_CLIENTS : Number(rawValue);
  if (!Number.isInteger(clients) || clients <= 0) {
    throw new Error(`--clients must be a positive integer. Received ${rawValue ?? clients}.`);
  }

  return clients;
}

function fanoutUserKey(index: number): string {
  return `fanout_user_${String(index + 1).padStart(3, "0")}`;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return Math.round(sorted[index] ?? 0);
}

async function ensureFanoutUsers(pool: Pool, clients: number): Promise<number[]> {
  const values: string[][] = Array.from({ length: clients }, (_, index) => [
    fanoutUserKey(index),
    `广播用户 ${String(index + 1).padStart(3, "0")}`,
    "bidder"
  ]);
  const placeholders = values.map(() => "(?, ?, ?)").join(", ");
  await pool.execute(
    `INSERT INTO users (demo_key, nickname, role)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       nickname = VALUES(nickname),
       role = VALUES(role)`,
    values.flat()
  );

  const keys = values.map((value) => value[0]!);
  const [rows] = await pool.execute<IdRow[]>(
    `SELECT id
     FROM users
     WHERE demo_key IN (${keys.map(() => "?").join(", ")})
     ORDER BY demo_key ASC`,
    keys
  );

  if (rows.length !== clients) {
    throw new Error(`Expected ${clients} fanout users, found ${rows.length}.`);
  }

  return rows.map((row) => Number(row.id));
}

async function createRunningAuction(pool: Pool, suffix: string): Promise<AuctionDto> {
  const room = await findDemoRoom(pool);
  const product = await createProduct(pool, {
    title: `实时广播演示商品 ${suffix}`,
    imageUrl: "https://example.com/realtime-fanout.png",
    description: "Created by demo:realtime-fanout."
  });
  const now = Date.now();
  const auction = await createAuction(pool, {
    roomId: room.id,
    productId: product.id,
    startPrice: 99,
    incrementStep: 10,
    ceilingPrice: null,
    startAt: new Date(now - 1_000).toISOString(),
    endAt: new Date(now + 60_000).toISOString(),
    extendThresholdSec: 10,
    extendDurationSec: 15
  });
  return startAuction(pool, auction.id);
}

async function emitAck(socket: Socket, event: string, payload: unknown): Promise<RealtimeAck> {
  return new Promise<RealtimeAck>((resolve) => {
    socket.emit(event, payload, (ack: RealtimeAck) => {
      resolve(ack);
    });
  });
}

async function openSocket(url: string): Promise<Socket> {
  const socket = io(url, {
    transports: ["websocket"]
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("WebSocket open timed out."));
    }, 5_000);
    socket.on("connect", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.on("connect_error", () => {
      clearTimeout(timeout);
      socket.close();
      reject(new Error("WebSocket failed to open."));
    });
  });

  return socket;
}

async function joinAndSubscribe(
  socket: Socket,
  roomId: number,
  userId: number,
  auctionId: number
): Promise<void> {
  const joinAck = await emitAck(socket, "room.join", { roomId, userId });
  if (!joinAck.ok) {
    throw new Error(joinAck.error?.message ?? `room.join failed for user ${userId}.`);
  }

  const subscribeAck = await emitAck(socket, "auction.subscribe", { auctionId });
  if (!subscribeAck.ok) {
    throw new Error(subscribeAck.error?.message ?? `auction.subscribe failed for user ${userId}.`);
  }
}

function waitForBidAccepted(
  socket: Socket,
  auctionId: number,
  requestId: string,
  startedAt: number,
  timeoutMs = 8_000
): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("bid.accepted", onMessage);
      reject(new Error("Timed out waiting for bid.accepted."));
    }, timeoutMs);

    function onMessage(event: unknown) {
      const packet = event as { payload?: { auctionId?: number; requestId?: string } };
      if (packet.payload?.auctionId === auctionId && packet.payload.requestId === requestId) {
        clearTimeout(timeout);
        socket.off("bid.accepted", onMessage);
        resolve(performance.now() - startedAt);
      }
    }

    socket.on("bid.accepted", onMessage);
  });
}

async function triggerBid(
  baseUrl: string,
  auctionId: number,
  userId: number,
  amount: number,
  requestId: string
): Promise<PlaceBidResponse> {
  const response = await fetch(`${baseUrl}/api/auctions/${auctionId}/bids`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      userId,
      amount,
      requestId
    })
  });
  const payload = (await response.json()) as PlaceBidResponse | { error?: { message?: string } };
  if (!response.ok) {
    const message = "error" in payload ? payload.error?.message : undefined;
    throw new Error(message ?? `Trigger bid failed with ${response.status}.`);
  }

  return payload as PlaceBidResponse;
}

async function startRuntime(
  pool: DbPool,
  redis: RedisCommandClient,
  bidCoordinator: BidCoordinator
): Promise<{
  app: FastifyInstance;
  realtimeHub: RealtimeHub;
  baseUrl: string;
}> {
  const realtimeHub = createRealtimeHub(pool, { redis, bidCoordinator });
  const app = await createApp({ pool, realtimeHub, bidCoordinator });
  realtimeHub.attach(app.server);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo;

  return {
    app,
    realtimeHub,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function main(): Promise<void> {
  const clients = parseClients();
  const pool = createDbPool();
  const redis = createRedisClient();
  await redis.connect();
  const bidCoordinator = createRedisBidCoordinator(redis);
  let app: FastifyInstance | null = null;
  let realtimeHub: RealtimeHub | null = null;
  const sockets: Socket[] = [];

  try {
    const runtime = await startRuntime(pool, redis, bidCoordinator);
    app = runtime.app;
    realtimeHub = runtime.realtimeHub;
    const suffix = `fanout-${clients}-${Date.now()}-${Math.round(Math.random() * 100000)}`;
    const userIds = await ensureFanoutUsers(pool, clients);
    const auction = await createRunningAuction(pool, suffix);

    for (const userId of userIds) {
      const socket = await openSocket(runtime.baseUrl);
      sockets.push(socket);
      await joinAndSubscribe(socket, auction.roomId, userId, auction.id);
    }

    const requestId = `${suffix}-trigger`;
    const startedAt = performance.now();
    const waits = sockets.map((socket) =>
      waitForBidAccepted(socket, auction.id, requestId, startedAt)
    );
    const bidResponse = await triggerBid(runtime.baseUrl, auction.id, userIds[0]!, 109, requestId);
    const settled = await Promise.allSettled(waits);
    const latencies = settled
      .filter((result): result is PromiseFulfilledResult<number> => result.status === "fulfilled")
      .map((result) => Math.round(result.value));
    const failures = settled.length - latencies.length;
    const totalDurationMs = latencies.length > 0 ? Math.max(...latencies) : 0;

    console.log(`clients=${clients}`);
    console.log(`connected=${sockets.length}`);
    console.log(`subscribed=${sockets.length}`);
    console.log(`auctionId=${auction.id}`);
    console.log(`triggerBidId=${bidResponse.bid.id}`);
    console.log(`triggerAmount=${bidResponse.bid.amount}`);
    console.log(`broadcastReceived=${latencies.length}`);
    console.log(`broadcastFailures=${failures}`);
    console.log(`durationMs=${totalDurationMs}`);
    console.log(`p50Ms=${percentile(latencies, 50)}`);
    console.log(`p95Ms=${percentile(latencies, 95)}`);
    console.log(`p99Ms=${percentile(latencies, 99)}`);

    if (latencies.length !== clients || failures !== 0) {
      throw new Error(`Fanout assertion failed: expected ${clients}, received ${latencies.length}.`);
    }
  } finally {
    for (const socket of sockets) {
      socket.close();
    }
    if (realtimeHub) {
      await realtimeHub.close();
    }
    if (app) {
      await app.close();
    }
    await pool.end();
  }
}

await main();
