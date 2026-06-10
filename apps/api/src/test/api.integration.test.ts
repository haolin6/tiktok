import type { FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";
import type { RowDataPacket } from "mysql2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AuctionDetailResponse,
  AuctionListResponse,
  AuctionSnapshotResponse,
  CancelAuctionResponse,
  CreateAuctionResponse,
  CreateProductResponse,
  MockPayOrderResponse,
  OrderListResponse,
  PlaceBidResponse,
  UpdateAuctionResponse,
  UserOrderListResponse
} from "@live-auction/shared";
import { createApp } from "../app.js";
import type { DbPool } from "../db/pool.js";
import { createDbPool } from "../db/pool.js";
import { createRealtimeHub, type RealtimeHub } from "../realtime/realtime-hub.js";
import { createRedisClient, type RedisCommandClient } from "../repositories/redis-client.js";
import { createRedisBidCoordinator } from "../services/bid-coordinator.js";
import {
  countBids,
  countEvents,
  createSecondRoom,
  expectNoRealtimeEvent,
  joinAndSubscribe,
  openSocket,
  sendRealtime,
  waitForRealtimeEvent
} from "./realtime-test-helpers.js";

interface IdRow extends RowDataPacket {
  id: number;
}

interface CountRow extends RowDataPacket {
  count: number;
}

interface AuctionStateRow extends RowDataPacket {
  current_price: string;
  end_at: Date;
  version: number;
}

interface EventPayloadRow extends RowDataPacket {
  payload_json: string | Record<string, unknown>;
}

async function findDemoRoomId(pool: DbPool): Promise<number> {
  const [rows] = await pool.execute<IdRow[]>(
    "SELECT id FROM auction_rooms WHERE demo_key = 'demo_room_main' LIMIT 1"
  );

  if (!rows[0]) {
    throw new Error("Demo room is missing. Run npm run db:seed.");
  }

  return Number(rows[0].id);
}

async function findDemoUserId(pool: DbPool, demoKey: string): Promise<number> {
  const [rows] = await pool.execute<IdRow[]>("SELECT id FROM users WHERE demo_key = ? LIMIT 1", [
    demoKey
  ]);

  if (!rows[0]) {
    throw new Error(`Demo user ${demoKey} is missing. Run npm run db:seed.`);
  }

  return Number(rows[0].id);
}

async function createProduct(app: FastifyInstance, title: string): Promise<CreateProductResponse> {
  const productResponse = await app.inject({
    method: "POST",
    url: "/api/products",
    payload: {
      title,
      imageUrl: "https://example.com/product.png",
      description: "Created by API integration test."
    }
  });

  expect(productResponse.statusCode).toBe(200);
  return productResponse.json<CreateProductResponse>();
}

async function createAuction(
  app: FastifyInstance,
  roomId: number,
  productId: number,
  options: Partial<{
    startPrice: number;
    incrementStep: number;
    ceilingPrice: number | null;
    endMsFromNow: number;
    extendThresholdSec: number;
    extendDurationSec: number;
  }> = {}
): Promise<CreateAuctionResponse> {
  const startAt = new Date(Date.now() - 1_000).toISOString();
  const endAt = new Date(Date.now() + (options.endMsFromNow ?? 60_000)).toISOString();
  const createAuctionResponse = await app.inject({
    method: "POST",
    url: "/api/auctions",
    payload: {
      roomId,
      productId,
      startPrice: options.startPrice ?? 99,
      incrementStep: options.incrementStep ?? 10,
      ceilingPrice: options.ceilingPrice ?? null,
      startAt,
      endAt,
      extendThresholdSec: options.extendThresholdSec,
      extendDurationSec: options.extendDurationSec
    }
  });

  expect(createAuctionResponse.statusCode).toBe(200);
  return createAuctionResponse.json<CreateAuctionResponse>();
}

async function startAuction(app: FastifyInstance, auctionId: number): Promise<CreateAuctionResponse> {
  const response = await app.inject({
    method: "POST",
    url: `/api/auctions/${auctionId}/start`
  });

  expect(response.statusCode).toBe(200);
  return response.json<CreateAuctionResponse>();
}

async function readLatestEventPayload(
  pool: DbPool,
  auctionId: number,
  eventType: string
): Promise<Record<string, unknown>> {
  const [rows] = await pool.execute<EventPayloadRow[]>(
    `SELECT payload_json
     FROM auction_events
     WHERE auction_id = ?
       AND event_type = ?
     ORDER BY id DESC
     LIMIT 1`,
    [auctionId, eventType]
  );
  const payload = rows[0]?.payload_json;
  if (!payload) {
    throw new Error(`Missing event ${eventType} for auction ${auctionId}.`);
  }

  return typeof payload === "string" ? JSON.parse(payload) : payload;
}

async function readAuctionState(pool: DbPool, auctionId: number): Promise<AuctionStateRow> {
  const [rows] = await pool.execute<AuctionStateRow[]>(
    "SELECT current_price, end_at, version FROM auctions WHERE id = ? LIMIT 1",
    [auctionId]
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`Auction ${auctionId} is missing.`);
  }

  return row;
}

function bidRequestKey(auctionId: number, userId: number, requestId: string): string {
  return `auction:${auctionId}:user:${userId}:request:${requestId}`;
}

function auctionLockKey(auctionId: number): string {
  return `auction:${auctionId}:lock`;
}

describe("node 1 API integration", () => {
  let pool: DbPool;
  let app: FastifyInstance;
  let realtimeHub: RealtimeHub;
  let redis: RedisCommandClient;
  let realtimeUrl: string;
  let roomId: number;
  let bidderAId: number;
  let bidderBId: number;
  let bidderCId: number;
  let streamerId: number;

  beforeAll(async () => {
    pool = createDbPool();
    redis = createRedisClient();
    await redis.connect();
    const bidCoordinator = createRedisBidCoordinator(redis);
    realtimeHub = createRealtimeHub(pool, { redis, bidCoordinator });
    app = await createApp({ pool, realtimeHub, bidCoordinator });
    realtimeHub.attach(app.server);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    realtimeUrl = `http://127.0.0.1:${address.port}`;
    roomId = await findDemoRoomId(pool);
    bidderAId = await findDemoUserId(pool, "demo_user_1");
    bidderBId = await findDemoUserId(pool, "demo_user_2");
    bidderCId = await findDemoUserId(pool, "demo_user_3");
    streamerId = await findDemoUserId(pool, "demo_streamer");
  });

  afterAll(async () => {
    await realtimeHub.close();
    await app.close();
    await pool.end();
  });

  it("responds to health checks", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      service: "live-auction-api"
    });
  });

  it("creates, reads, snapshots, and cancels an auction through real handlers and SQL", async () => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`;

    const productResponse = await app.inject({
      method: "POST",
      url: "/api/products",
      payload: {
        title: `节点1测试商品 ${uniqueSuffix}`,
        imageUrl: "https://example.com/product.png",
        description: "Created by API integration test."
      }
    });

    expect(productResponse.statusCode).toBe(200);
    const productBody = productResponse.json<CreateProductResponse>();
    expect(productBody.product.id).toBeGreaterThan(0);
    expect(productBody.product.title).toContain("节点1测试商品");

    const startAt = new Date(Date.now() + 60_000).toISOString();
    const endAt = new Date(Date.now() + 180_000).toISOString();

    const createAuctionResponse = await app.inject({
      method: "POST",
      url: "/api/auctions",
      payload: {
        roomId,
        productId: productBody.product.id,
        startPrice: 99,
        incrementStep: 10,
        ceilingPrice: 299,
        startAt,
        endAt
      }
    });

    expect(createAuctionResponse.statusCode).toBe(200);
    const auctionBody = createAuctionResponse.json<CreateAuctionResponse>();
    expect(auctionBody.auction.status).toBe("Scheduled");
    expect(auctionBody.auction.currentPrice).toBe(99);

    const [productRows] = await pool.execute<IdRow[]>(
      "SELECT id FROM products WHERE id = ? LIMIT 1",
      [productBody.product.id]
    );
    expect(productRows).toHaveLength(1);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/auctions"
    });
    expect(listResponse.statusCode).toBe(200);
    const listBody = listResponse.json<AuctionListResponse>();
    expect(listBody.items.some((item) => item.id === auctionBody.auction.id)).toBe(true);

    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/auctions/${auctionBody.auction.id}`
    });
    expect(detailResponse.statusCode).toBe(200);
    const detailBody = detailResponse.json<AuctionDetailResponse>();
    expect(detailBody.auction.id).toBe(auctionBody.auction.id);

    const snapshotResponse = await app.inject({
      method: "GET",
      url: `/api/auctions/${auctionBody.auction.id}/snapshot`
    });
    expect(snapshotResponse.statusCode).toBe(200);
    const snapshotBody = snapshotResponse.json<AuctionSnapshotResponse>();
    expect(snapshotBody.auction.id).toBe(auctionBody.auction.id);
    expect(snapshotBody.product.id).toBe(productBody.product.id);
    expect(snapshotBody.room.id).toBe(roomId);
    expect(snapshotBody.currentPrice).toBe(99);

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${auctionBody.auction.id}/cancel`,
      payload: {
        reason: "node 1 integration test cleanup"
      }
    });
    expect(cancelResponse.statusCode).toBe(200);
    const cancelBody = cancelResponse.json<CancelAuctionResponse>();
    expect(cancelBody.auction.status).toBe("Canceled");
    expect(cancelBody.auction.version).toBe(auctionBody.auction.version + 1);

    const duplicateCancelResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${auctionBody.auction.id}/cancel`,
      payload: {
        reason: "duplicate cancel should fail"
      }
    });
    expect(duplicateCancelResponse.statusCode).toBe(409);

    const [eventRows] = await pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS count
       FROM auction_events
       WHERE auction_id = ?
         AND event_type IN ('auction.created', 'auction.canceled')`,
      [auctionBody.auction.id]
    );
    expect(Number(eventRows[0]?.count ?? 0)).toBe(2);
  });

  it("updates only Scheduled auction rules and rejects invalid or terminal updates", async () => {
    const uniqueSuffix = `p0-update-${Date.now()}-${Math.round(Math.random() * 100000)}`;
    const productBody = await createProduct(app, `P0规则编辑商品 ${uniqueSuffix}`);
    const auctionBody = await createAuction(app, roomId, productBody.product.id, {
      startPrice: 100,
      incrementStep: 10,
      ceilingPrice: 200
    });
    const startAt = new Date(Date.now() + 30_000).toISOString();
    const endAt = new Date(Date.now() + 120_000).toISOString();

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/auctions/${auctionBody.auction.id}`,
      payload: {
        startPrice: 120,
        incrementStep: 15,
        ceilingPrice: null,
        startAt,
        endAt,
        extendThresholdSec: 7,
        extendDurationSec: 12
      }
    });
    expect(updateResponse.statusCode).toBe(200);
    const updateBody = updateResponse.json<UpdateAuctionResponse>();
    expect(updateBody.auction.status).toBe("Scheduled");
    expect(updateBody.auction.startPrice).toBe(120);
    expect(updateBody.auction.currentPrice).toBe(120);
    expect(updateBody.auction.incrementStep).toBe(15);
    expect(updateBody.auction.ceilingPrice).toBeNull();
    expect(updateBody.auction.extendThresholdSec).toBe(7);
    expect(updateBody.auction.extendDurationSec).toBe(12);
    expect(updateBody.auction.version).toBe(auctionBody.auction.version + 1);

    const updatedState = await readAuctionState(pool, auctionBody.auction.id);
    expect(Number(updatedState.current_price)).toBe(120);
    const updatePayload = await readLatestEventPayload(pool, auctionBody.auction.id, "auction.updated");
    expect(updatePayload).toMatchObject({
      auctionId: auctionBody.auction.id,
      previous: {
        startPrice: 100,
        incrementStep: 10,
        ceilingPrice: 200
      },
      current: {
        startPrice: 120,
        incrementStep: 15,
        ceilingPrice: null,
        extendThresholdSec: 7,
        extendDurationSec: 12
      }
    });

    const invalidCeilingResponse = await app.inject({
      method: "PATCH",
      url: `/api/auctions/${auctionBody.auction.id}`,
      payload: {
        startPrice: 150,
        ceilingPrice: 100
      }
    });
    expect(invalidCeilingResponse.statusCode).toBe(400);

    const invalidTimeResponse = await app.inject({
      method: "PATCH",
      url: `/api/auctions/${auctionBody.auction.id}`,
      payload: {
        startAt: new Date(Date.now() + 120_000).toISOString(),
        endAt: new Date(Date.now() + 30_000).toISOString()
      }
    });
    expect(invalidTimeResponse.statusCode).toBe(400);

    const emptyBodyResponse = await app.inject({
      method: "PATCH",
      url: `/api/auctions/${auctionBody.auction.id}`,
      payload: {}
    });
    expect(emptyBodyResponse.statusCode).toBe(400);

    const unknownFieldResponse = await app.inject({
      method: "PATCH",
      url: `/api/auctions/${auctionBody.auction.id}`,
      payload: {
        title: "should not be accepted"
      }
    });
    expect(unknownFieldResponse.statusCode).toBe(400);

    const runningProduct = await createProduct(app, `P0 Running不可编辑商品 ${uniqueSuffix}`);
    const runningAuction = await createAuction(app, roomId, runningProduct.product.id);
    await startAuction(app, runningAuction.auction.id);
    const runningUpdateResponse = await app.inject({
      method: "PATCH",
      url: `/api/auctions/${runningAuction.auction.id}`,
      payload: { startPrice: 150 }
    });
    expect(runningUpdateResponse.statusCode).toBe(409);

    const soldProduct = await createProduct(app, `P0 Sold不可编辑商品 ${uniqueSuffix}`);
    const soldAuction = await createAuction(app, roomId, soldProduct.product.id, {
      startPrice: 99,
      incrementStep: 10,
      ceilingPrice: 109
    });
    await startAuction(app, soldAuction.auction.id);
    const soldBidResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${soldAuction.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 109,
        requestId: `${uniqueSuffix}-sold`
      }
    });
    expect(soldBidResponse.statusCode).toBe(200);
    const soldUpdateResponse = await app.inject({
      method: "PATCH",
      url: `/api/auctions/${soldAuction.auction.id}`,
      payload: { startPrice: 150 }
    });
    expect(soldUpdateResponse.statusCode).toBe(409);

    const passedProduct = await createProduct(app, `P0 Passed不可编辑商品 ${uniqueSuffix}`);
    const passedAuction = await createAuction(app, roomId, passedProduct.product.id);
    await startAuction(app, passedAuction.auction.id);
    await pool.execute("UPDATE auctions SET end_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?", [
      passedAuction.auction.id
    ]);
    const passedSnapshotResponse = await app.inject({
      method: "GET",
      url: `/api/auctions/${passedAuction.auction.id}/snapshot`
    });
    expect(passedSnapshotResponse.statusCode).toBe(200);
    expect(passedSnapshotResponse.json<AuctionSnapshotResponse>().auction.status).toBe("Passed");
    const passedUpdateResponse = await app.inject({
      method: "PATCH",
      url: `/api/auctions/${passedAuction.auction.id}`,
      payload: { startPrice: 150 }
    });
    expect(passedUpdateResponse.statusCode).toBe(409);

    const canceledProduct = await createProduct(app, `P0 Canceled不可编辑商品 ${uniqueSuffix}`);
    const canceledAuction = await createAuction(app, roomId, canceledProduct.product.id);
    const cancelResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${canceledAuction.auction.id}/cancel`,
      payload: { reason: "p0 update boundary" }
    });
    expect(cancelResponse.statusCode).toBe(200);
    const canceledUpdateResponse = await app.inject({
      method: "PATCH",
      url: `/api/auctions/${canceledAuction.auction.id}`,
      payload: { startPrice: 150 }
    });
    expect(canceledUpdateResponse.statusCode).toBe(409);
  });

  it("starts an auction, accepts sequential bids, sells at the ceiling, creates an order, and mock pays it", async () => {
    const uniqueSuffix = `node2-ceiling-${Date.now()}-${Math.round(Math.random() * 100000)}`;
    const productBody = await createProduct(app, `节点2封顶测试商品 ${uniqueSuffix}`);
    const auctionBody = await createAuction(app, roomId, productBody.product.id, {
      startPrice: 99,
      incrementStep: 10,
      ceilingPrice: 119
    });

    const startedBody = await startAuction(app, auctionBody.auction.id);
    expect(startedBody.auction.status).toBe("Running");

    const bidAResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${auctionBody.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 109,
        requestId: `${uniqueSuffix}-bid-a`
      }
    });
    expect(bidAResponse.statusCode).toBe(200);
    const bidABody = bidAResponse.json<PlaceBidResponse>();
    expect(bidABody.bid.accepted).toBe(true);
    expect(bidABody.auction.currentPrice).toBe(109);
    expect(bidABody.auction.currentWinnerId).toBe(bidderAId);
    expect(bidABody.snapshot.currentWinner?.id).toBe(bidderAId);
    expect(bidABody.previousWinnerId).toBeNull();

    const bidBResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${auctionBody.auction.id}/bids`,
      payload: {
        userId: bidderBId,
        amount: 119,
        requestId: `${uniqueSuffix}-bid-b`
      }
    });
    expect(bidBResponse.statusCode).toBe(200);
    const bidBBody = bidBResponse.json<PlaceBidResponse>();
    expect(bidBBody.auction.status).toBe("Sold");
    expect(bidBBody.auction.currentPrice).toBe(119);
    expect(bidBBody.auction.currentWinnerId).toBe(bidderBId);
    expect(bidBBody.snapshot.order?.buyerId).toBe(bidderBId);
    expect(bidBBody.previousWinnerId).toBe(bidderAId);

    const [auctionRows] = await pool.execute<IdRow[]>(
      "SELECT id FROM auctions WHERE id = ? AND status = 'Sold' AND current_winner_id = ? LIMIT 1",
      [auctionBody.auction.id, bidderBId]
    );
    expect(auctionRows).toHaveLength(1);

    const [acceptedBidRows] = await pool.execute<CountRow[]>(
      "SELECT COUNT(*) AS count FROM bids WHERE auction_id = ? AND accepted = TRUE",
      [auctionBody.auction.id]
    );
    expect(Number(acceptedBidRows[0]?.count ?? 0)).toBe(2);

    const ordersResponse = await app.inject({
      method: "GET",
      url: "/api/orders"
    });
    expect(ordersResponse.statusCode).toBe(200);
    const ordersBody = ordersResponse.json<OrderListResponse>();
    const order = ordersBody.items.find((item) => item.auctionId === auctionBody.auction.id);
    expect(order).toBeDefined();
    expect(order?.status).toBe("pending_payment");
    expect(order?.buyerId).toBe(bidderBId);

    const userOrdersResponse = await app.inject({
      method: "GET",
      url: `/api/me/orders?userId=${bidderBId}`
    });
    expect(userOrdersResponse.statusCode).toBe(200);
    const userOrdersBody = userOrdersResponse.json<UserOrderListResponse>();
    expect(userOrdersBody.items.some((item) => item.auctionId === auctionBody.auction.id)).toBe(
      true
    );

    const otherUserOrdersResponse = await app.inject({
      method: "GET",
      url: `/api/me/orders?userId=${bidderCId}`
    });
    expect(otherUserOrdersResponse.statusCode).toBe(200);
    const otherUserOrdersBody = otherUserOrdersResponse.json<UserOrderListResponse>();
    expect(otherUserOrdersBody.items.some((item) => item.auctionId === auctionBody.auction.id)).toBe(
      false
    );

    const payResponse = await app.inject({
      method: "POST",
      url: `/api/orders/${order?.id}/mock-pay`
    });
    expect(payResponse.statusCode).toBe(200);
    const payBody = payResponse.json<MockPayOrderResponse>();
    expect(payBody.order.status).toBe("paid");

    const terminalBidResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${auctionBody.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 129,
        requestId: `${uniqueSuffix}-terminal-bid`
      }
    });
    expect(terminalBidResponse.statusCode).toBe(409);
  });

  it("accepts multi-step bids, clamps ceiling bids, and keeps stale amounts rejected", async () => {
    const uniqueSuffix = `multi-step-${Date.now()}-${Math.round(Math.random() * 100000)}`;

    const multiStepProduct = await createProduct(app, `多档出价商品 ${uniqueSuffix}`);
    const multiStepAuction = await createAuction(app, roomId, multiStepProduct.product.id, {
      startPrice: 850,
      incrementStep: 50,
      ceilingPrice: null
    });
    await startAuction(app, multiStepAuction.auction.id);

    const multiStepResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${multiStepAuction.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 950,
        requestId: `${uniqueSuffix}-a-950`
      }
    });
    expect(multiStepResponse.statusCode).toBe(200);
    const multiStepBody = multiStepResponse.json<PlaceBidResponse>();
    expect(multiStepBody.bid.amount).toBe(950);
    expect(multiStepBody.auction.currentPrice).toBe(950);
    expect(multiStepBody.snapshot.nextBidAmount).toBe(1000);

    const staleResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${multiStepAuction.auction.id}/bids`,
      payload: {
        userId: bidderBId,
        amount: 900,
        requestId: `${uniqueSuffix}-b-stale-900`
      }
    });
    expect(staleResponse.statusCode).toBe(409);
    expect(staleResponse.json<{ error: { message: string } }>().error.message).toContain(
      "at least 1000"
    );
    expect(Number((await readAuctionState(pool, multiStepAuction.auction.id)).current_price)).toBe(950);

    const selfRaiseResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${multiStepAuction.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 1000,
        requestId: `${uniqueSuffix}-a-self-1000`
      }
    });
    expect(selfRaiseResponse.statusCode).toBe(200);
    const selfRaiseBody = selfRaiseResponse.json<PlaceBidResponse>();
    expect(selfRaiseBody.previousWinnerId).toBe(bidderAId);
    expect(selfRaiseBody.auction.currentWinnerId).toBe(bidderAId);
    expect(selfRaiseBody.auction.currentPrice).toBe(1000);

    const unalignedProduct = await createProduct(app, `非步长拒绝商品 ${uniqueSuffix}`);
    const unalignedAuction = await createAuction(app, roomId, unalignedProduct.product.id, {
      startPrice: 850,
      incrementStep: 50,
      ceilingPrice: null
    });
    await startAuction(app, unalignedAuction.auction.id);
    const unalignedResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${unalignedAuction.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 920,
        requestId: `${uniqueSuffix}-unaligned-920`
      }
    });
    expect(unalignedResponse.statusCode).toBe(409);
    expect(unalignedResponse.json<{ error: { message: string } }>().error.message).toContain(
      "increment step 50"
    );
    expect(Number((await readAuctionState(pool, unalignedAuction.auction.id)).current_price)).toBe(850);

    const orderedProduct = await createProduct(app, `顺序竞争商品 ${uniqueSuffix}`);
    const orderedAuction = await createAuction(app, roomId, orderedProduct.product.id, {
      startPrice: 850,
      incrementStep: 50,
      ceilingPrice: null
    });
    await startAuction(app, orderedAuction.auction.id);
    const firstOrderedResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${orderedAuction.auction.id}/bids`,
      payload: {
        userId: bidderBId,
        amount: 900,
        requestId: `${uniqueSuffix}-b-900`
      }
    });
    expect(firstOrderedResponse.statusCode).toBe(200);
    const secondOrderedResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${orderedAuction.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 950,
        requestId: `${uniqueSuffix}-a-950-after-900`
      }
    });
    expect(secondOrderedResponse.statusCode).toBe(200);
    expect(secondOrderedResponse.json<PlaceBidResponse>().auction.currentPrice).toBe(950);

    const ceilingProduct = await createProduct(app, `封顶截断商品 ${uniqueSuffix}`);
    const ceilingAuction = await createAuction(app, roomId, ceilingProduct.product.id, {
      startPrice: 850,
      incrementStep: 50,
      ceilingPrice: 1000
    });
    await startAuction(app, ceilingAuction.auction.id);
    const ceilingResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${ceilingAuction.auction.id}/bids`,
      payload: {
        userId: bidderCId,
        amount: 1050,
        requestId: `${uniqueSuffix}-c-1050-clamp`
      }
    });
    expect(ceilingResponse.statusCode).toBe(200);
    const ceilingBody = ceilingResponse.json<PlaceBidResponse>();
    expect(ceilingBody.bid.amount).toBe(1000);
    expect(ceilingBody.auction.status).toBe("Sold");
    expect(ceilingBody.snapshot.order?.amount).toBe(1000);

    const oddCeilingProduct = await createProduct(app, `非步长封顶商品 ${uniqueSuffix}`);
    const oddCeilingAuction = await createAuction(app, roomId, oddCeilingProduct.product.id, {
      startPrice: 850,
      incrementStep: 50,
      ceilingPrice: 980
    });
    await startAuction(app, oddCeilingAuction.auction.id);
    const oddCeilingResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${oddCeilingAuction.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 980,
        requestId: `${uniqueSuffix}-a-980-ceiling`
      }
    });
    expect(oddCeilingResponse.statusCode).toBe(200);
    const oddCeilingBody = oddCeilingResponse.json<PlaceBidResponse>();
    expect(oddCeilingBody.bid.amount).toBe(980);
    expect(oddCeilingBody.auction.status).toBe("Sold");
    expect(oddCeilingBody.snapshot.order?.amount).toBe(980);
  });

  it("rejects invalid bids and keeps the auction price stable", async () => {
    const uniqueSuffix = `node2-reject-${Date.now()}-${Math.round(Math.random() * 100000)}`;
    const productBody = await createProduct(app, `节点2拒绝测试商品 ${uniqueSuffix}`);
    const auctionBody = await createAuction(app, roomId, productBody.product.id, {
      startPrice: 50,
      incrementStep: 5,
      ceilingPrice: 80
    });
    await startAuction(app, auctionBody.auction.id);

    const tooLowResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${auctionBody.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 50,
        requestId: `${uniqueSuffix}-too-low`
      }
    });
    expect(tooLowResponse.statusCode).toBe(409);

    const jumpResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${auctionBody.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 66,
        requestId: `${uniqueSuffix}-unaligned`
      }
    });
    expect(jumpResponse.statusCode).toBe(409);

    const streamerBidResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${auctionBody.auction.id}/bids`,
      payload: {
        userId: streamerId,
        amount: 55,
        requestId: `${uniqueSuffix}-streamer`
      }
    });
    expect(streamerBidResponse.statusCode).toBe(400);

    const validResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${auctionBody.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 55,
        requestId: `${uniqueSuffix}-valid`
      }
    });
    expect(validResponse.statusCode).toBe(200);

    const duplicateResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${auctionBody.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 55,
        requestId: `${uniqueSuffix}-valid`
      }
    });
    expect(duplicateResponse.statusCode).toBe(200);
    const duplicateBody = duplicateResponse.json<PlaceBidResponse>();
    expect(duplicateBody.idempotentReplay).toBe(true);
    expect(duplicateBody.auction.currentPrice).toBe(55);

    const snapshotResponse = await app.inject({
      method: "GET",
      url: `/api/auctions/${auctionBody.auction.id}/snapshot`
    });
    expect(snapshotResponse.statusCode).toBe(200);
    const snapshotBody = snapshotResponse.json<AuctionSnapshotResponse>();
    expect(snapshotBody.auction.currentPrice).toBe(55);
    expect(snapshotBody.nextBidAmount).toBe(60);

    const [rejectedBidRows] = await pool.execute<CountRow[]>(
      "SELECT COUNT(*) AS count FROM bids WHERE auction_id = ? AND accepted = FALSE",
      [auctionBody.auction.id]
    );
    expect(Number(rejectedBidRows[0]?.count ?? 0)).toBe(2);

    const [acceptedBidRows] = await pool.execute<CountRow[]>(
      "SELECT COUNT(*) AS count FROM bids WHERE auction_id = ? AND accepted = TRUE",
      [auctionBody.auction.id]
    );
    expect(Number(acceptedBidRows[0]?.count ?? 0)).toBe(1);
  });

  it("extends running auctions near the end and skips extension outside the threshold or at ceiling", async () => {
    const uniqueSuffix = `node3-extension-${Date.now()}-${Math.round(Math.random() * 100000)}`;

    const extendingProduct = await createProduct(app, `节点3延时测试商品 ${uniqueSuffix}`);
    const extendingAuction = await createAuction(app, roomId, extendingProduct.product.id, {
      startPrice: 99,
      incrementStep: 10,
      ceilingPrice: null,
      endMsFromNow: 5_000,
      extendThresholdSec: 10,
      extendDurationSec: 15
    });
    await startAuction(app, extendingAuction.auction.id);
    const previousEndAt = new Date(extendingAuction.auction.endAt).getTime();

    const extendingBidResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${extendingAuction.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 109,
        requestId: `${uniqueSuffix}-extend`
      }
    });
    expect(extendingBidResponse.statusCode).toBe(200);
    const extendingBid = extendingBidResponse.json<PlaceBidResponse>();
    expect(extendingBid.extension).not.toBeNull();
    expect(new Date(extendingBid.auction.endAt).getTime()).toBeGreaterThan(previousEndAt);
    expect(extendingBid.auction.version).toBeGreaterThan(extendingAuction.auction.version + 1);

    const [extensionEventRows] = await pool.execute<CountRow[]>(
      "SELECT COUNT(*) AS count FROM auction_events WHERE auction_id = ? AND event_type = 'auction.extended'",
      [extendingAuction.auction.id]
    );
    expect(Number(extensionEventRows[0]?.count ?? 0)).toBe(1);

    const steadyProduct = await createProduct(app, `节点3不延时测试商品 ${uniqueSuffix}`);
    const steadyAuction = await createAuction(app, roomId, steadyProduct.product.id, {
      startPrice: 50,
      incrementStep: 5,
      ceilingPrice: null,
      endMsFromNow: 20_000,
      extendThresholdSec: 10,
      extendDurationSec: 15
    });
    await startAuction(app, steadyAuction.auction.id);
    const steadyBidResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${steadyAuction.auction.id}/bids`,
      payload: {
        userId: bidderBId,
        amount: 55,
        requestId: `${uniqueSuffix}-steady`
      }
    });
    expect(steadyBidResponse.statusCode).toBe(200);
    const steadyBid = steadyBidResponse.json<PlaceBidResponse>();
    expect(steadyBid.extension).toBeNull();

    const ceilingProduct = await createProduct(app, `节点3封顶不延时商品 ${uniqueSuffix}`);
    const ceilingAuction = await createAuction(app, roomId, ceilingProduct.product.id, {
      startPrice: 99,
      incrementStep: 10,
      ceilingPrice: 109,
      endMsFromNow: 5_000,
      extendThresholdSec: 10,
      extendDurationSec: 15
    });
    await startAuction(app, ceilingAuction.auction.id);
    const ceilingBidResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${ceilingAuction.auction.id}/bids`,
      payload: {
        userId: bidderCId,
        amount: 109,
        requestId: `${uniqueSuffix}-ceiling`
      }
    });
    expect(ceilingBidResponse.statusCode).toBe(200);
    const ceilingBid = ceilingBidResponse.json<PlaceBidResponse>();
    expect(ceilingBid.auction.status).toBe("Sold");
    expect(ceilingBid.extension).toBeNull();
  });

  it("syncs websocket subscribers, isolates unjoined sockets, and broadcasts paid orders", async () => {
    const uniqueSuffix = `node3-ws-${Date.now()}-${Math.round(Math.random() * 100000)}`;
    const productBody = await createProduct(app, `节点3实时测试商品 ${uniqueSuffix}`);
    const auctionBody = await createAuction(app, roomId, productBody.product.id, {
      startPrice: 99,
      incrementStep: 10,
      ceilingPrice: 119,
      endMsFromNow: 60_000
    });
    await startAuction(app, auctionBody.auction.id);

    const socketA = await openSocket(realtimeUrl);
    const socketB = await openSocket(realtimeUrl);
    const unjoinedSocket = await openSocket(realtimeUrl);

    try {
      expect((await sendRealtime(socketA, "room.join", { roomId, userId: bidderAId })).ok).toBe(true);
      expect((await sendRealtime(socketB, "room.join", { roomId, userId: bidderBId })).ok).toBe(true);

      const unjoinedAck = await sendRealtime(unjoinedSocket, "auction.subscribe", {
        auctionId: auctionBody.auction.id
      });
      expect(unjoinedAck.ok).toBe(false);

      const socketASnapshot = waitForRealtimeEvent(socketA, "auction.snapshot", (packet) => {
        return packet.data.payload.auction.id === auctionBody.auction.id;
      });
      const socketBSnapshot = waitForRealtimeEvent(socketB, "auction.snapshot", (packet) => {
        return packet.data.payload.auction.id === auctionBody.auction.id;
      });
      expect((await sendRealtime(socketA, "auction.subscribe", { auctionId: auctionBody.auction.id })).ok).toBe(
        true
      );
      expect((await sendRealtime(socketB, "auction.subscribe", { auctionId: auctionBody.auction.id })).ok).toBe(
        true
      );
      await socketASnapshot;
      await socketBSnapshot;

      const acceptedForB = waitForRealtimeEvent(socketB, "bid.accepted", (packet) => {
        return packet.data.payload.userId === bidderAId && packet.data.payload.amount === 109;
      });
      const updatedSnapshotForB = waitForRealtimeEvent(socketB, "auction.snapshot", (packet) => {
        return packet.data.payload.auction.id === auctionBody.auction.id && packet.data.payload.currentPrice === 109;
      });
      const bidAck = await sendRealtime(socketA, "bid.place", {
        auctionId: auctionBody.auction.id,
        amount: 109,
        requestId: `${uniqueSuffix}-a`
      });
      expect(bidAck.ok).toBe(true);
      await acceptedForB;
      await updatedSnapshotForB;

      const mismatchedUserAck = await sendRealtime(socketA, "bid.place", {
        auctionId: auctionBody.auction.id,
        amount: 119,
        requestId: `${uniqueSuffix}-mismatch`,
        userId: bidderBId
      });
      expect(mismatchedUserAck.ok).toBe(false);

      const soldForA = waitForRealtimeEvent(socketA, "auction.sold", (packet) => {
        return packet.data.payload.buyerId === bidderBId && packet.data.payload.amount === 119;
      });
      const bidBAck = await sendRealtime(socketB, "bid.place", {
        auctionId: auctionBody.auction.id,
        amount: 119,
        requestId: `${uniqueSuffix}-b`
      });
      expect(bidBAck.ok).toBe(true);
      await soldForA;

      const ordersResponse = await app.inject({ method: "GET", url: "/api/orders" });
      expect(ordersResponse.statusCode).toBe(200);
      const order = ordersResponse
        .json<OrderListResponse>()
        .items.find((item) => item.auctionId === auctionBody.auction.id);
      expect(order).toBeDefined();

      const paidForA = waitForRealtimeEvent(socketA, "order.paid", (packet) => {
        return packet.data.payload.orderId === order?.id && packet.data.payload.status === "paid";
      });
      const payResponse = await app.inject({
        method: "POST",
        url: `/api/orders/${order?.id}/mock-pay`
      });
      expect(payResponse.statusCode).toBe(200);
      await paidForA;
    } finally {
      socketA.close();
      socketB.close();
      unjoinedSocket.close();
    }
  });

  it("keeps room presence accurate when one user has multiple open sockets", async () => {
    const uniqueSuffix = `presence-${Date.now()}-${Math.round(Math.random() * 100000)}`;
    const presenceRoomId = await createSecondRoom(pool, uniqueSuffix);
    const socketA1 = await openSocket(realtimeUrl);
    const socketA2 = await openSocket(realtimeUrl);
    const socketB = await openSocket(realtimeUrl);
    const socketC = await openSocket(realtimeUrl);

    try {
      const firstPresence = waitForRealtimeEvent(socketA1, "room.presence", (packet) => {
        return packet.data.payload.roomId === presenceRoomId && packet.data.payload.onlineCount === 1;
      });
      expect((await sendRealtime(socketA1, "room.join", { roomId: presenceRoomId, userId: bidderAId })).ok).toBe(
        true
      );
      await firstPresence;

      const duplicatePresence = waitForRealtimeEvent(socketA1, "room.presence", (packet) => {
        return packet.data.payload.roomId === presenceRoomId && packet.data.payload.onlineCount === 1;
      });
      expect((await sendRealtime(socketA2, "room.join", { roomId: presenceRoomId, userId: bidderAId })).ok).toBe(
        true
      );
      await duplicatePresence;

      const secondUserPresence = waitForRealtimeEvent(socketA1, "room.presence", (packet) => {
        return packet.data.payload.roomId === presenceRoomId && packet.data.payload.onlineCount === 2;
      });
      expect((await sendRealtime(socketB, "room.join", { roomId: presenceRoomId, userId: bidderBId })).ok).toBe(
        true
      );
      await secondUserPresence;

      const thirdUserPresence = waitForRealtimeEvent(socketA1, "room.presence", (packet) => {
        return packet.data.payload.roomId === presenceRoomId && packet.data.payload.onlineCount === 3;
      });
      expect((await sendRealtime(socketC, "room.join", { roomId: presenceRoomId, userId: bidderCId })).ok).toBe(
        true
      );
      await thirdUserPresence;

      const afterDuplicateClose = waitForRealtimeEvent(socketA1, "room.presence", (packet) => {
        return packet.data.payload.roomId === presenceRoomId && packet.data.payload.onlineCount === 3;
      });
      socketA2.close();
      await afterDuplicateClose;

      const afterFinalAClose = waitForRealtimeEvent(socketB, "room.presence", (packet) => {
        return packet.data.payload.roomId === presenceRoomId && packet.data.payload.onlineCount === 2;
      });
      socketA1.close();
      await afterFinalAClose;
    } finally {
      socketA1.close();
      socketA2.close();
      socketB.close();
      socketC.close();
    }
  });

  it("sends user.outbid only to the previous winner and keeps event payloads consistent", async () => {
    const uniqueSuffix = `p0-outbid-${Date.now()}-${Math.round(Math.random() * 100000)}`;
    const productBody = await createProduct(app, `P0被超越提醒商品 ${uniqueSuffix}`);
    const auctionBody = await createAuction(app, roomId, productBody.product.id, {
      startPrice: 99,
      incrementStep: 10,
      ceilingPrice: null
    });
    await startAuction(app, auctionBody.auction.id);
    const otherRoomId = await createSecondRoom(pool, uniqueSuffix);

    const socketA = await openSocket(realtimeUrl);
    const socketB = await openSocket(realtimeUrl);
    const socketC = await openSocket(realtimeUrl);
    const otherRoomSocket = await openSocket(realtimeUrl);
    const unjoinedSocket = await openSocket(realtimeUrl);

    try {
      await joinAndSubscribe(socketA, roomId, bidderAId, auctionBody.auction.id);
      await joinAndSubscribe(socketB, roomId, bidderBId, auctionBody.auction.id);
      await joinAndSubscribe(socketC, roomId, bidderCId, auctionBody.auction.id);
      expect((await sendRealtime(otherRoomSocket, "room.join", { roomId: otherRoomId, userId: bidderCId })).ok).toBe(
        true
      );

      const firstBidAck = await sendRealtime(socketA, "bid.place", {
        auctionId: auctionBody.auction.id,
        amount: 109,
        requestId: `${uniqueSuffix}-a`
      });
      expect(firstBidAck.ok).toBe(true);
      expect((firstBidAck.payload as PlaceBidResponse).previousWinnerId).toBeNull();

      const outbidForA = waitForRealtimeEvent(socketA, "user.outbid", (packet) => {
        return (
          packet.data.payload.auctionId === auctionBody.auction.id &&
          packet.data.payload.previousWinnerId === bidderAId &&
          packet.data.payload.newWinnerId === bidderBId &&
          packet.data.payload.amount === 119
        );
      });
      const acceptedForC = waitForRealtimeEvent(socketC, "bid.accepted", (packet) => {
        return (
          packet.data.payload.auctionId === auctionBody.auction.id &&
          packet.data.payload.userId === bidderBId &&
          packet.data.payload.previousWinnerId === bidderAId
        );
      });
      const noOutbidForB = expectNoRealtimeEvent(socketB, "user.outbid", (packet) => {
        return packet.data.payload.auctionId === auctionBody.auction.id;
      });
      const noOutbidForC = expectNoRealtimeEvent(socketC, "user.outbid", (packet) => {
        return packet.data.payload.auctionId === auctionBody.auction.id;
      });
      const noOutbidForOtherRoom = expectNoRealtimeEvent(otherRoomSocket, "user.outbid", (packet) => {
        return packet.data.payload.auctionId === auctionBody.auction.id;
      });
      const noOutbidForUnjoined = expectNoRealtimeEvent(unjoinedSocket, "user.outbid", (packet) => {
        return packet.data.payload.auctionId === auctionBody.auction.id;
      });

      const secondBidAck = await sendRealtime(socketB, "bid.place", {
        auctionId: auctionBody.auction.id,
        amount: 119,
        requestId: `${uniqueSuffix}-b`
      });
      expect(secondBidAck.ok).toBe(true);
      expect((secondBidAck.payload as PlaceBidResponse).previousWinnerId).toBe(bidderAId);

      const outbidEvent = await outbidForA;
      expect(outbidEvent.data.payload).toMatchObject({
        auctionId: auctionBody.auction.id,
        previousWinnerId: bidderAId,
        newWinnerId: bidderBId,
        amount: 119
      });
      await acceptedForC;
      await Promise.all([noOutbidForB, noOutbidForC, noOutbidForOtherRoom, noOutbidForUnjoined]);

      const acceptedPayload = await readLatestEventPayload(pool, auctionBody.auction.id, "bid.accepted");
      expect(acceptedPayload).toMatchObject({
        auctionId: auctionBody.auction.id,
        userId: bidderBId,
        amount: 119,
        previousWinnerId: bidderAId
      });
      expect(await countEvents(pool, auctionBody.auction.id, "bid.accepted")).toBe(2);
    } finally {
      socketA.close();
      socketB.close();
      socketC.close();
      otherRoomSocket.close();
      unjoinedSocket.close();
    }
  });

  it("broadcasts start and cancel state changes with database-consistent payloads", async () => {
    const uniqueSuffix = `node3-cancel-${Date.now()}-${Math.round(Math.random() * 100000)}`;

    const scheduledProduct = await createProduct(app, `节点3取消Scheduled商品 ${uniqueSuffix}`);
    const scheduledAuction = await createAuction(app, roomId, scheduledProduct.product.id);
    const scheduledSocket = await openSocket(realtimeUrl);
    try {
      await joinAndSubscribe(scheduledSocket, roomId, bidderAId, scheduledAuction.auction.id);
      const canceledEvent = waitForRealtimeEvent(scheduledSocket, "auction.canceled", (packet) => {
        return packet.data.auctionId === scheduledAuction.auction.id;
      });
      const canceledSnapshot = waitForRealtimeEvent(scheduledSocket, "auction.snapshot", (packet) => {
        return (
          packet.data.payload.auction.id === scheduledAuction.auction.id &&
          packet.data.payload.auction.status === "Canceled"
        );
      });

      const cancelResponse = await app.inject({
        method: "POST",
        url: `/api/auctions/${scheduledAuction.auction.id}/cancel`,
        payload: { reason: "scheduled cancel regression test" }
      });
      expect(cancelResponse.statusCode).toBe(200);
      const realtimeCanceled = await canceledEvent;
      expect(realtimeCanceled.data.payload).toMatchObject({
        auctionId: scheduledAuction.auction.id,
        previousStatus: "Scheduled",
        status: "Canceled",
        reason: "scheduled cancel regression test"
      });
      expect((await canceledSnapshot).data.payload.auction.status).toBe("Canceled");
      expect(await readLatestEventPayload(pool, scheduledAuction.auction.id, "auction.canceled")).toMatchObject(
        realtimeCanceled.data.payload
      );
    } finally {
      scheduledSocket.close();
    }

    const runningProduct = await createProduct(app, `节点3取消Running商品 ${uniqueSuffix}`);
    const runningAuction = await createAuction(app, roomId, runningProduct.product.id);
    await startAuction(app, runningAuction.auction.id);
    const runningSocket = await openSocket(realtimeUrl);
    try {
      await joinAndSubscribe(runningSocket, roomId, bidderBId, runningAuction.auction.id);
      const bidResponse = await app.inject({
        method: "POST",
        url: `/api/auctions/${runningAuction.auction.id}/bids`,
        payload: {
          userId: bidderBId,
          amount: 109,
          requestId: `${uniqueSuffix}-running-before-cancel`
        }
      });
      expect(bidResponse.statusCode).toBe(200);
      expect(bidResponse.json<PlaceBidResponse>().bid.amount).toBe(109);

      const canceledEvent = waitForRealtimeEvent(runningSocket, "auction.canceled", (packet) => {
        return packet.data.auctionId === runningAuction.auction.id;
      });
      const canceledSnapshot = waitForRealtimeEvent(runningSocket, "auction.snapshot", (packet) => {
        return (
          packet.data.payload.auction.id === runningAuction.auction.id &&
          packet.data.payload.auction.status === "Canceled"
        );
      });
      const cancelResponse = await app.inject({
        method: "POST",
        url: `/api/auctions/${runningAuction.auction.id}/cancel`,
        payload: { reason: "running cancel regression test" }
      });
      expect(cancelResponse.statusCode).toBe(200);
      expect((await canceledEvent).data.payload).toMatchObject({
        auctionId: runningAuction.auction.id,
        previousStatus: "Running",
        status: "Canceled"
      });
      expect((await canceledSnapshot).data.payload.order).toBeNull();
      const [orderRows] = await pool.execute<CountRow[]>(
        "SELECT COUNT(*) AS count FROM orders WHERE auction_id = ?",
        [runningAuction.auction.id]
      );
      expect(Number(orderRows[0]?.count ?? 0)).toBe(0);
    } finally {
      runningSocket.close();
    }

    const startProduct = await createProduct(app, `节点3开始广播商品 ${uniqueSuffix}`);
    const startAuctionBody = await createAuction(app, roomId, startProduct.product.id);
    const startSocket = await openSocket(realtimeUrl);
    try {
      await joinAndSubscribe(startSocket, roomId, bidderCId, startAuctionBody.auction.id);
      const runningSnapshot = waitForRealtimeEvent(startSocket, "auction.snapshot", (packet) => {
        return (
          packet.data.payload.auction.id === startAuctionBody.auction.id &&
          packet.data.payload.auction.status === "Running"
        );
      });
      await startAuction(app, startAuctionBody.auction.id);
      expect((await runningSnapshot).data.payload.auction.status).toBe("Running");
    } finally {
      startSocket.close();
    }

    const soldProduct = await createProduct(app, `节点3取消Sold失败商品 ${uniqueSuffix}`);
    const soldAuction = await createAuction(app, roomId, soldProduct.product.id, {
      startPrice: 99,
      incrementStep: 10,
      ceilingPrice: 109
    });
    await startAuction(app, soldAuction.auction.id);
    const sellResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${soldAuction.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 109,
        requestId: `${uniqueSuffix}-sell-before-cancel`
      }
    });
    expect(sellResponse.statusCode).toBe(200);

    const soldSocket = await openSocket(realtimeUrl);
    try {
      await joinAndSubscribe(soldSocket, roomId, bidderBId, soldAuction.auction.id);
      const noCanceled = expectNoRealtimeEvent(soldSocket, "auction.canceled", (packet) => {
        return packet.data.auctionId === soldAuction.auction.id;
      });
      const failedCancelResponse = await app.inject({
        method: "POST",
        url: `/api/auctions/${soldAuction.auction.id}/cancel`,
        payload: { reason: "sold cancel should fail" }
      });
      expect(failedCancelResponse.statusCode).toBe(409);
      await noCanceled;
      expect(await countEvents(pool, soldAuction.auction.id, "auction.canceled")).toBe(0);
    } finally {
      soldSocket.close();
    }
  });

  it("sends bid.rejected only to the failing socket and separates identity failures from business rejections", async () => {
    const uniqueSuffix = `node3-rejected-${Date.now()}-${Math.round(Math.random() * 100000)}`;
    const productBody = await createProduct(app, `节点3 rejected 隔离商品 ${uniqueSuffix}`);
    const auctionBody = await createAuction(app, roomId, productBody.product.id, {
      startPrice: 99,
      incrementStep: 10,
      ceilingPrice: null
    });
    await startAuction(app, auctionBody.auction.id);

    const socketA = await openSocket(realtimeUrl);
    const socketB = await openSocket(realtimeUrl);
    try {
      await joinAndSubscribe(socketA, roomId, bidderAId, auctionBody.auction.id);
      await joinAndSubscribe(socketB, roomId, bidderBId, auctionBody.auction.id);

      const wrongAmountRequestId = `${uniqueSuffix}-wrong-amount`;
      const rejectedForA = waitForRealtimeEvent(socketA, "bid.rejected", (packet) => {
        return packet.data.payload.requestId === wrongAmountRequestId;
      });
      const noRejectedForB = expectNoRealtimeEvent(socketB, "bid.rejected", (packet) => {
        return packet.data.payload.requestId === wrongAmountRequestId;
      });
      const wrongAmountAck = await sendRealtime(socketA, "bid.place", {
        auctionId: auctionBody.auction.id,
        amount: 115,
        requestId: wrongAmountRequestId
      });
      expect(wrongAmountAck.ok).toBe(false);
      const rejectedEvent = await rejectedForA;
      expect(rejectedEvent.data.payload).toMatchObject({
        auctionId: auctionBody.auction.id,
        userId: bidderAId,
        amount: 115,
        requestId: wrongAmountRequestId
      });
      expect(rejectedEvent.data.payload.reason).toContain("increment step 10");
      await noRejectedForB;
      expect(await countBids(pool, auctionBody.auction.id, { accepted: false })).toBe(1);
      expect(await countEvents(pool, auctionBody.auction.id, "bid.rejected")).toBe(1);
      expect(Number((await readAuctionState(pool, auctionBody.auction.id)).current_price)).toBe(99);

      const mismatchRequestId = `${uniqueSuffix}-mismatch`;
      const noMismatchRejectedForA = expectNoRealtimeEvent(socketA, "bid.rejected", (packet) => {
        return packet.data.payload.requestId === mismatchRequestId;
      });
      const noMismatchRejectedForB = expectNoRealtimeEvent(socketB, "bid.rejected", (packet) => {
        return packet.data.payload.requestId === mismatchRequestId;
      });
      const mismatchAck = await sendRealtime(socketA, "bid.place", {
        auctionId: auctionBody.auction.id,
        amount: 109,
        requestId: mismatchRequestId,
        userId: bidderBId
      });
      expect(mismatchAck.ok).toBe(false);
      expect(mismatchAck.error?.code).toBe("VALIDATION_ERROR");
      await noMismatchRejectedForA;
      await noMismatchRejectedForB;
      expect(await countBids(pool, auctionBody.auction.id, { requestId: mismatchRequestId })).toBe(0);
      expect(await countEvents(pool, auctionBody.auction.id, "bid.rejected")).toBe(1);
    } finally {
      socketA.close();
      socketB.close();
    }

    const soldProduct = await createProduct(app, `节点3 terminal rejected 商品 ${uniqueSuffix}`);
    const soldAuction = await createAuction(app, roomId, soldProduct.product.id, {
      startPrice: 99,
      incrementStep: 10,
      ceilingPrice: 109
    });
    await startAuction(app, soldAuction.auction.id);
    const soldResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${soldAuction.auction.id}/bids`,
      payload: {
        userId: bidderBId,
        amount: 109,
        requestId: `${uniqueSuffix}-sell`
      }
    });
    expect(soldResponse.statusCode).toBe(200);

    const [orderRowsBefore] = await pool.execute<CountRow[]>(
      "SELECT COUNT(*) AS count FROM orders WHERE auction_id = ?",
      [soldAuction.auction.id]
    );
    const terminalSocket = await openSocket(realtimeUrl);
    try {
      await joinAndSubscribe(terminalSocket, roomId, bidderAId, soldAuction.auction.id);
      const terminalRequestId = `${uniqueSuffix}-terminal`;
      const terminalRejected = waitForRealtimeEvent(terminalSocket, "bid.rejected", (packet) => {
        return packet.data.payload.requestId === terminalRequestId;
      });
      const terminalAck = await sendRealtime(terminalSocket, "bid.place", {
        auctionId: soldAuction.auction.id,
        amount: 119,
        requestId: terminalRequestId
      });
      expect(terminalAck.ok).toBe(false);
      expect((await terminalRejected).data.payload.reason).toContain("Sold");
    } finally {
      terminalSocket.close();
    }
    const [orderRowsAfter] = await pool.execute<CountRow[]>(
      "SELECT COUNT(*) AS count FROM orders WHERE auction_id = ?",
      [soldAuction.auction.id]
    );
    expect(Number(orderRowsAfter[0]?.count ?? 0)).toBe(Number(orderRowsBefore[0]?.count ?? 0));
  });

  it("blocks cross-room subscribe and bid attempts before they can mutate the target auction", async () => {
    const uniqueSuffix = `node3-cross-room-${Date.now()}-${Math.round(Math.random() * 100000)}`;
    const otherRoomId = await createSecondRoom(pool, uniqueSuffix);
    const productBody = await createProduct(app, `节点3跨房间隔离商品 ${uniqueSuffix}`);
    const auctionBody = await createAuction(app, otherRoomId, productBody.product.id, {
      startPrice: 99,
      incrementStep: 10,
      ceilingPrice: null
    });
    await startAuction(app, auctionBody.auction.id);

    const wrongRoomSocket = await openSocket(realtimeUrl);
    const correctRoomSocket = await openSocket(realtimeUrl);
    try {
      const wrongJoinAck = await sendRealtime(wrongRoomSocket, "room.join", {
        roomId,
        userId: bidderAId
      });
      expect(wrongJoinAck.ok).toBe(true);
      await joinAndSubscribe(correctRoomSocket, otherRoomId, bidderBId, auctionBody.auction.id);

      const noWrongRoomSnapshot = expectNoRealtimeEvent(wrongRoomSocket, "auction.snapshot", (packet) => {
        return packet.data.payload.auction.id === auctionBody.auction.id;
      });
      const subscribeAck = await sendRealtime(wrongRoomSocket, "auction.subscribe", {
        auctionId: auctionBody.auction.id
      });
      expect(subscribeAck.ok).toBe(false);
      await noWrongRoomSnapshot;

      const crossRoomRequestId = `${uniqueSuffix}-cross-bid`;
      const noAcceptedForCorrectRoom = expectNoRealtimeEvent(correctRoomSocket, "bid.accepted", (packet) => {
        return packet.data.payload.requestId === crossRoomRequestId;
      });
      const noChangedSnapshot = expectNoRealtimeEvent(correctRoomSocket, "auction.snapshot", (packet) => {
        return (
          packet.data.payload.auction.id === auctionBody.auction.id &&
          packet.data.payload.currentPrice === 109
        );
      });
      const bidAck = await sendRealtime(wrongRoomSocket, "bid.place", {
        auctionId: auctionBody.auction.id,
        amount: 109,
        requestId: crossRoomRequestId
      });
      expect(bidAck.ok).toBe(false);
      await noAcceptedForCorrectRoom;
      await noChangedSnapshot;
      expect(await countBids(pool, auctionBody.auction.id, { requestId: crossRoomRequestId })).toBe(0);
      expect(Number((await readAuctionState(pool, auctionBody.auction.id)).current_price)).toBe(99);
    } finally {
      wrongRoomSocket.close();
      correctRoomSocket.close();
    }
  });

  it("keeps Redis idempotency states consistent for accepted, rejected, processing, and lock-busy bids", async () => {
    const uniqueSuffix = `node3-redis-idem-${Date.now()}-${Math.round(Math.random() * 100000)}`;

    const acceptedProduct = await createProduct(app, `节点3幂等accepted商品 ${uniqueSuffix}`);
    const acceptedAuction = await createAuction(app, roomId, acceptedProduct.product.id, {
      startPrice: 99,
      incrementStep: 10,
      ceilingPrice: null
    });
    await startAuction(app, acceptedAuction.auction.id);
    const acceptedRequestId = `${uniqueSuffix}-accepted`;
    const acceptedResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${acceptedAuction.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 109,
        requestId: acceptedRequestId
      }
    });
    expect(acceptedResponse.statusCode).toBe(200);
    const acceptedReplayResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${acceptedAuction.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 109,
        requestId: acceptedRequestId
      }
    });
    expect(acceptedReplayResponse.statusCode).toBe(200);
    expect(acceptedReplayResponse.json<PlaceBidResponse>().idempotentReplay).toBe(true);
    expect(await countBids(pool, acceptedAuction.auction.id, { accepted: true })).toBe(1);
    expect(await countEvents(pool, acceptedAuction.auction.id, "bid.accepted")).toBe(1);
    expect(Number((await readAuctionState(pool, acceptedAuction.auction.id)).current_price)).toBe(109);
    expect(
      (await redis.get(bidRequestKey(acceptedAuction.auction.id, bidderAId, acceptedRequestId)))?.startsWith(
        "accepted:"
      )
    ).toBe(true);

    const rejectedProduct = await createProduct(app, `节点3幂等rejected商品 ${uniqueSuffix}`);
    const rejectedAuction = await createAuction(app, roomId, rejectedProduct.product.id, {
      startPrice: 99,
      incrementStep: 10,
      ceilingPrice: null
    });
    await startAuction(app, rejectedAuction.auction.id);
    const rejectedRequestId = `${uniqueSuffix}-rejected`;
    const rejectedResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${rejectedAuction.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 115,
        requestId: rejectedRequestId
      }
    });
    expect(rejectedResponse.statusCode).toBe(409);
    const rejectedReplayResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${rejectedAuction.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 115,
        requestId: rejectedRequestId
      }
    });
    expect(rejectedReplayResponse.statusCode).toBe(409);
    expect(await countBids(pool, rejectedAuction.auction.id, { accepted: false })).toBe(1);
    expect(await countEvents(pool, rejectedAuction.auction.id, "bid.rejected")).toBe(1);
    expect(Number((await readAuctionState(pool, rejectedAuction.auction.id)).current_price)).toBe(99);
    const rejectedState = await redis.get(
      bidRequestKey(rejectedAuction.auction.id, bidderAId, rejectedRequestId)
    );
    expect(rejectedState?.startsWith("rejected:")).toBe(true);
    expect(rejectedState).toContain("Bid amount must align to increment step 10.");

    const processingProduct = await createProduct(app, `节点3幂等processing商品 ${uniqueSuffix}`);
    const processingAuction = await createAuction(app, roomId, processingProduct.product.id, {
      startPrice: 99,
      incrementStep: 10,
      ceilingPrice: null
    });
    await startAuction(app, processingAuction.auction.id);
    const processingRequestId = `${uniqueSuffix}-processing`;
    await redis.set(
      bidRequestKey(processingAuction.auction.id, bidderAId, processingRequestId),
      "processing",
      ["PX", "5000"]
    );
    const processingResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${processingAuction.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 109,
        requestId: processingRequestId
      }
    });
    expect(processingResponse.statusCode).toBe(409);
    expect(processingResponse.json<{ error: { code: string } }>().error.code).toBe(
      "DUPLICATE_PROCESSING"
    );
    expect(await countBids(pool, processingAuction.auction.id, { requestId: processingRequestId })).toBe(0);
    expect(await countEvents(pool, processingAuction.auction.id, "bid.rejected")).toBe(0);
    expect(Number((await readAuctionState(pool, processingAuction.auction.id)).current_price)).toBe(99);
    await redis.del(bidRequestKey(processingAuction.auction.id, bidderAId, processingRequestId));

    const busyProduct = await createProduct(app, `节点3锁忙恢复商品 ${uniqueSuffix}`);
    const busyAuction = await createAuction(app, roomId, busyProduct.product.id, {
      startPrice: 99,
      incrementStep: 10,
      ceilingPrice: null
    });
    await startAuction(app, busyAuction.auction.id);
    const busyRequestId = `${uniqueSuffix}-busy`;
    await redis.set(auctionLockKey(busyAuction.auction.id), "held-by-test", ["PX", "1500"]);
    const busyResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${busyAuction.auction.id}/bids`,
      payload: {
        userId: bidderBId,
        amount: 109,
        requestId: busyRequestId
      }
    });
    expect(busyResponse.statusCode).toBe(409);
    expect(busyResponse.json<{ error: { code: string } }>().error.code).toBe("LOCK_BUSY");
    expect(await countBids(pool, busyAuction.auction.id, { requestId: busyRequestId })).toBe(1);
    expect(await countBids(pool, busyAuction.auction.id, { rejectReason: "lock_busy" })).toBe(1);
    expect(await countEvents(pool, busyAuction.auction.id, "bid.rejected")).toBe(1);
    expect(
      (await redis.get(bidRequestKey(busyAuction.auction.id, bidderBId, busyRequestId)))?.startsWith(
        "rejected:"
      )
    ).toBe(true);
    await redis.del(auctionLockKey(busyAuction.auction.id));

    const recoveredResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${busyAuction.auction.id}/bids`,
      payload: {
        userId: bidderCId,
        amount: 109,
        requestId: `${uniqueSuffix}-after-busy`
      }
    });
    expect(recoveredResponse.statusCode).toBe(200);
    expect(recoveredResponse.json<PlaceBidResponse>().auction.currentPrice).toBe(109);
  });

  it("extends auctions at the threshold with HTTP, Socket.IO, and MySQL evidence", async () => {
    const uniqueSuffix = `node3-extension-boundary-${Date.now()}-${Math.round(Math.random() * 100000)}`;

    const boundaryProduct = await createProduct(app, `节点3临界延时商品 ${uniqueSuffix}`);
    const boundaryAuction = await createAuction(app, roomId, boundaryProduct.product.id, {
      startPrice: 99,
      incrementStep: 10,
      ceilingPrice: null,
      endMsFromNow: 60_000,
      extendThresholdSec: 10,
      extendDurationSec: 15
    });
    await startAuction(app, boundaryAuction.auction.id);
    await pool.execute(
      `UPDATE auctions
       SET end_at = DATE_ADD(NOW(3), INTERVAL 10 SECOND),
           extend_threshold_sec = 10
       WHERE id = ?`,
      [boundaryAuction.auction.id]
    );
    const beforeBoundary = await readAuctionState(pool, boundaryAuction.auction.id);

    const boundarySocket = await openSocket(realtimeUrl);
    try {
      await joinAndSubscribe(boundarySocket, roomId, bidderAId, boundaryAuction.auction.id);
      const extendedEvent = waitForRealtimeEvent(boundarySocket, "auction.extended", (packet) => {
        return packet.data.auctionId === boundaryAuction.auction.id;
      });
      const extensionSnapshot = waitForRealtimeEvent(boundarySocket, "auction.snapshot", (packet) => {
        return (
          packet.data.payload.auction.id === boundaryAuction.auction.id &&
          packet.data.payload.currentPrice === 109
        );
      });
      const bidResponse = await app.inject({
        method: "POST",
        url: `/api/auctions/${boundaryAuction.auction.id}/bids`,
        payload: {
          userId: bidderAId,
          amount: 109,
          requestId: `${uniqueSuffix}-boundary`
        }
      });
      expect(bidResponse.statusCode).toBe(200);
      const bidBody = bidResponse.json<PlaceBidResponse>();
      expect(bidBody.extension).not.toBeNull();
      const extendedPayload = (await extendedEvent).data.payload;
      expect(extendedPayload).toMatchObject(bidBody.extension ?? {});
      expect((await extensionSnapshot).data.payload.auction.endAt).toBe(bidBody.auction.endAt);
      const afterBoundary = await readAuctionState(pool, boundaryAuction.auction.id);
      expect(new Date(afterBoundary.end_at).getTime()).toBeGreaterThan(
        new Date(beforeBoundary.end_at).getTime()
      );
      expect(afterBoundary.version).toBeGreaterThan(beforeBoundary.version);
      expect(
        Math.abs(new Date(afterBoundary.end_at).getTime() - new Date(bidBody.auction.endAt).getTime())
      ).toBeLessThan(1_000);
      expect(await countEvents(pool, boundaryAuction.auction.id, "auction.extended")).toBe(1);
    } finally {
      boundarySocket.close();
    }

    const outsideProduct = await createProduct(app, `节点3阈值外不延时商品 ${uniqueSuffix}`);
    const outsideAuction = await createAuction(app, roomId, outsideProduct.product.id, {
      startPrice: 99,
      incrementStep: 10,
      ceilingPrice: null,
      endMsFromNow: 60_000,
      extendThresholdSec: 10,
      extendDurationSec: 15
    });
    await startAuction(app, outsideAuction.auction.id);
    await pool.execute(
      `UPDATE auctions
       SET end_at = DATE_ADD(NOW(3), INTERVAL 20 SECOND),
           extend_threshold_sec = 10
       WHERE id = ?`,
      [outsideAuction.auction.id]
    );
    const outsideResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${outsideAuction.auction.id}/bids`,
      payload: {
        userId: bidderBId,
        amount: 109,
        requestId: `${uniqueSuffix}-outside`
      }
    });
    expect(outsideResponse.statusCode).toBe(200);
    expect(outsideResponse.json<PlaceBidResponse>().extension).toBeNull();
    expect(await countEvents(pool, outsideAuction.auction.id, "auction.extended")).toBe(0);

    const ceilingProduct = await createProduct(app, `节点3封顶优先商品 ${uniqueSuffix}`);
    const ceilingAuction = await createAuction(app, roomId, ceilingProduct.product.id, {
      startPrice: 99,
      incrementStep: 10,
      ceilingPrice: 109,
      endMsFromNow: 60_000,
      extendThresholdSec: 10,
      extendDurationSec: 15
    });
    await startAuction(app, ceilingAuction.auction.id);
    await pool.execute(
      `UPDATE auctions
       SET end_at = DATE_ADD(NOW(3), INTERVAL 10 SECOND),
           extend_threshold_sec = 10
       WHERE id = ?`,
      [ceilingAuction.auction.id]
    );
    const ceilingResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${ceilingAuction.auction.id}/bids`,
      payload: {
        userId: bidderCId,
        amount: 109,
        requestId: `${uniqueSuffix}-ceiling`
      }
    });
    expect(ceilingResponse.statusCode).toBe(200);
    const ceilingBody = ceilingResponse.json<PlaceBidResponse>();
    expect(ceilingBody.auction.status).toBe("Sold");
    expect(ceilingBody.extension).toBeNull();
    expect(await countEvents(pool, ceilingAuction.auction.id, "auction.extended")).toBe(0);
  });

  it("settles ended auctions as sold with a winner or passed without bids", async () => {
    const uniqueSuffix = `node2-ended-${Date.now()}-${Math.round(Math.random() * 100000)}`;

    const soldProduct = await createProduct(app, `节点2到期成交测试商品 ${uniqueSuffix}`);
    const soldAuction = await createAuction(app, roomId, soldProduct.product.id, {
      startPrice: 20,
      incrementStep: 5,
      ceilingPrice: null
    });
    await startAuction(app, soldAuction.auction.id);

    const bidResponse = await app.inject({
      method: "POST",
      url: `/api/auctions/${soldAuction.auction.id}/bids`,
      payload: {
        userId: bidderAId,
        amount: 25,
        requestId: `${uniqueSuffix}-winner`
      }
    });
    expect(bidResponse.statusCode).toBe(200);

    const soldSocket = await openSocket(realtimeUrl);
    try {
      expect((await sendRealtime(soldSocket, "room.join", { roomId, userId: bidderBId })).ok).toBe(true);
      const initialSnapshot = waitForRealtimeEvent(soldSocket, "auction.snapshot", (packet) => {
        return packet.data.payload.auction.id === soldAuction.auction.id;
      });
      expect((await sendRealtime(soldSocket, "auction.subscribe", { auctionId: soldAuction.auction.id })).ok).toBe(
        true
      );
      await initialSnapshot;

      await pool.execute("UPDATE auctions SET end_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?", [
        soldAuction.auction.id
      ]);

      const soldEvent = waitForRealtimeEvent(soldSocket, "auction.sold", (packet) => {
        return packet.data.payload.auctionId === soldAuction.auction.id && packet.data.payload.reason === "ended";
      });
      const soldSnapshotEvent = waitForRealtimeEvent(soldSocket, "auction.snapshot", (packet) => {
        return packet.data.payload.auction.id === soldAuction.auction.id && packet.data.payload.auction.status === "Sold";
      });

      const soldSnapshotResponse = await app.inject({
        method: "GET",
        url: `/api/auctions/${soldAuction.auction.id}/snapshot`
      });
      expect(soldSnapshotResponse.statusCode).toBe(200);
      const soldSnapshot = soldSnapshotResponse.json<AuctionSnapshotResponse>();
      expect(soldSnapshot.auction.status).toBe("Sold");
      expect(soldSnapshot.order?.buyerId).toBe(bidderAId);
      await soldEvent;
      await soldSnapshotEvent;

      const orderCountBefore = await pool.execute<CountRow[]>(
        "SELECT COUNT(*) AS count FROM orders WHERE auction_id = ?",
        [soldAuction.auction.id]
      );
      expect(Number(orderCountBefore[0][0]?.count ?? 0)).toBe(1);

      const noRepeatedSoldEvent = expectNoRealtimeEvent(soldSocket, "auction.sold", (packet) => {
        return packet.data.payload.auctionId === soldAuction.auction.id;
      });
      const repeatedSnapshotResponse = await app.inject({
        method: "GET",
        url: `/api/auctions/${soldAuction.auction.id}/snapshot`
      });
      expect(repeatedSnapshotResponse.statusCode).toBe(200);
      await noRepeatedSoldEvent;

      const orderCountAfter = await pool.execute<CountRow[]>(
        "SELECT COUNT(*) AS count FROM orders WHERE auction_id = ?",
        [soldAuction.auction.id]
      );
      expect(Number(orderCountAfter[0][0]?.count ?? 0)).toBe(1);
    } finally {
      soldSocket.close();
    }

    const passedProduct = await createProduct(app, `节点2流拍测试商品 ${uniqueSuffix}`);
    const passedAuction = await createAuction(app, roomId, passedProduct.product.id, {
      startPrice: 30,
      incrementStep: 5,
      ceilingPrice: null
    });
    await startAuction(app, passedAuction.auction.id);
    const passedSocket = await openSocket(realtimeUrl);
    try {
      expect((await sendRealtime(passedSocket, "room.join", { roomId, userId: bidderCId })).ok).toBe(true);
      const initialSnapshot = waitForRealtimeEvent(passedSocket, "auction.snapshot", (packet) => {
        return packet.data.payload.auction.id === passedAuction.auction.id;
      });
      expect((await sendRealtime(passedSocket, "auction.subscribe", { auctionId: passedAuction.auction.id })).ok).toBe(
        true
      );
      await initialSnapshot;

      await pool.execute("UPDATE auctions SET end_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?", [
        passedAuction.auction.id
      ]);

      const passedEvent = waitForRealtimeEvent(passedSocket, "auction.passed", (packet) => {
        return packet.data.payload.auctionId === passedAuction.auction.id && packet.data.payload.reason === "ended";
      });
      const passedSnapshotEvent = waitForRealtimeEvent(passedSocket, "auction.snapshot", (packet) => {
        return packet.data.payload.auction.id === passedAuction.auction.id && packet.data.payload.auction.status === "Passed";
      });

      const passedSnapshotResponse = await app.inject({
        method: "GET",
        url: `/api/auctions/${passedAuction.auction.id}/snapshot`
      });
      expect(passedSnapshotResponse.statusCode).toBe(200);
      const passedSnapshot = passedSnapshotResponse.json<AuctionSnapshotResponse>();
      expect(passedSnapshot.auction.status).toBe("Passed");
      expect(passedSnapshot.order).toBeNull();
      await passedEvent;
      await passedSnapshotEvent;
    } finally {
      passedSocket.close();
    }

    const [passedOrderRows] = await pool.execute<CountRow[]>(
      "SELECT COUNT(*) AS count FROM orders WHERE auction_id = ?",
      [passedAuction.auction.id]
    );
    expect(Number(passedOrderRows[0]?.count ?? 0)).toBe(0);
  });
});
