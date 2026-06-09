import type { RowDataPacket } from "mysql2";
import type { AuctionDto } from "@live-auction/shared";
import { createDbPool } from "../db/pool.js";
import { AppError } from "../errors.js";
import { findAuctionById } from "../repositories/auctions-repository.js";
import { createRedisClient, type RedisCommandClient } from "../repositories/redis-client.js";
import { findDemoRoom } from "../repositories/rooms-repository.js";
import { createAuction, placeBid, startAuction } from "../services/auctions-service.js";
import { createRedisBidCoordinator, type BidCoordinator } from "../services/bid-coordinator.js";
import { createProduct } from "../services/products-service.js";

interface IdRow extends RowDataPacket {
  id: number;
}

interface CountRow extends RowDataPacket {
  count: number;
}

interface EventCountRow extends RowDataPacket {
  event_type: string;
  event_count: number;
}

const UNIQUE_ATTEMPTS = 100;
const DUPLICATE_ATTEMPTS = 10;

type Mode = "unique" | "duplicate-accepted" | "duplicate-rejected" | "lock-busy";
type Pool = ReturnType<typeof createDbPool>;
type SqlValue = string | number | boolean | null;

interface ModeResult {
  auctionId: number;
  attempts: number;
  accepted: number;
  rejected: number;
  duplicate: number;
  lockBusy: number;
  businessRejected: number;
  durationMs: number;
}

function loadUserKey(index: number): string {
  return `load_user_${String(index + 1).padStart(3, "0")}`;
}

function parseMode(): Mode {
  const rawMode = process.argv
    .find((arg) => arg.startsWith("--mode="))
    ?.slice("--mode=".length);
  if (
    rawMode === undefined ||
    rawMode === "unique" ||
    rawMode === "duplicate-accepted" ||
    rawMode === "duplicate-rejected" ||
    rawMode === "lock-busy"
  ) {
    return rawMode ?? "unique";
  }

  throw new Error(`Unsupported mode=${rawMode}.`);
}

function auctionLockKey(auctionId: number): string {
  return `auction:${auctionId}:lock`;
}

async function ensureLoadUsers(pool: Pool): Promise<number[]> {
  const values: string[][] = Array.from({ length: UNIQUE_ATTEMPTS }, (_, index) => [
    loadUserKey(index),
    `并发用户 ${String(index + 1).padStart(3, "0")}`,
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

  if (rows.length !== UNIQUE_ATTEMPTS) {
    throw new Error(`Expected ${UNIQUE_ATTEMPTS} load users, found ${rows.length}.`);
  }

  return rows.map((row) => Number(row.id));
}

async function countRows(pool: Pool, query: string, params: SqlValue[]): Promise<number> {
  const [rows] = await pool.execute<CountRow[]>(query, params);
  return Number(rows[0]?.count ?? 0);
}

async function createRunningAuction(
  pool: Pool,
  suffix: string,
  options: { ceilingPrice: number | null }
): Promise<AuctionDto> {
  const room = await findDemoRoom(pool);
  const product = await createProduct(pool, {
    title: `节点3并发演示商品 ${suffix}`,
    imageUrl: "https://example.com/concurrency.png",
    description: "Created by demo:concurrency."
  });
  const now = Date.now();
  const auction = await createAuction(pool, {
    roomId: room.id,
    productId: product.id,
    startPrice: 99,
    incrementStep: 10,
    ceilingPrice: options.ceilingPrice,
    startAt: new Date(now - 1_000).toISOString(),
    endAt: new Date(now + 60_000).toISOString(),
    extendThresholdSec: 10,
    extendDurationSec: 15
  });
  await startAuction(pool, auction.id);
  return auction;
}

async function runUniqueMode(
  pool: Pool,
  bidCoordinator: BidCoordinator,
  userIds: number[],
  suffix: string
): Promise<ModeResult> {
  const auction = await createRunningAuction(pool, suffix, { ceilingPrice: 109 });
  const startedAt = performance.now();
  const results = await Promise.allSettled(
    userIds.map((userId) =>
      placeBid(
        pool,
        auction.id,
        {
          userId,
          amount: 109,
          requestId: `${suffix}-${userId}`
        },
        { bidCoordinator }
      )
    )
  );

  const summary = summarizeSettledResults(results);
  return {
    auctionId: auction.id,
    attempts: UNIQUE_ATTEMPTS,
    durationMs: Math.round(performance.now() - startedAt),
    ...summary
  };
}

async function runDuplicateAcceptedMode(
  pool: Pool,
  bidCoordinator: BidCoordinator,
  userId: number,
  suffix: string
): Promise<ModeResult> {
  const auction = await createRunningAuction(pool, suffix, { ceilingPrice: null });
  const requestId = `${suffix}-accepted-replay`;
  const startedAt = performance.now();
  const first = await placeBid(
    pool,
    auction.id,
    { userId, amount: 109, requestId },
    { bidCoordinator }
  );
  const replays = await Promise.allSettled(
    Array.from({ length: DUPLICATE_ATTEMPTS - 1 }, () =>
      placeBid(
        pool,
        auction.id,
        { userId, amount: 109, requestId },
        { bidCoordinator }
      )
    )
  );
  const duplicate = replays.filter(
    (result) => result.status === "fulfilled" && result.value.idempotentReplay
  ).length;

  return {
    auctionId: auction.id,
    attempts: DUPLICATE_ATTEMPTS,
    accepted: first.idempotentReplay ? 0 : 1,
    rejected: replays.filter((result) => result.status === "rejected").length,
    duplicate,
    lockBusy: 0,
    businessRejected: 0,
    durationMs: Math.round(performance.now() - startedAt)
  };
}

async function runDuplicateRejectedMode(
  pool: Pool,
  bidCoordinator: BidCoordinator,
  userId: number,
  suffix: string
): Promise<ModeResult> {
  const auction = await createRunningAuction(pool, suffix, { ceilingPrice: null });
  const requestId = `${suffix}-rejected-replay`;
  const startedAt = performance.now();
  await expectAppError(() =>
    placeBid(
      pool,
      auction.id,
      { userId, amount: 119, requestId },
      { bidCoordinator }
    )
  );
  const replays = await Promise.allSettled(
    Array.from({ length: DUPLICATE_ATTEMPTS - 1 }, () =>
      placeBid(
        pool,
        auction.id,
        { userId, amount: 119, requestId },
        { bidCoordinator }
      )
    )
  );

  return {
    auctionId: auction.id,
    attempts: DUPLICATE_ATTEMPTS,
    accepted: 0,
    rejected: DUPLICATE_ATTEMPTS,
    duplicate: replays.filter((result) => result.status === "rejected").length,
    lockBusy: 0,
    businessRejected: 1,
    durationMs: Math.round(performance.now() - startedAt)
  };
}

async function runLockBusyMode(
  pool: Pool,
  redis: RedisCommandClient,
  bidCoordinator: BidCoordinator,
  userIds: number[],
  suffix: string
): Promise<ModeResult> {
  const auction = await createRunningAuction(pool, suffix, { ceilingPrice: null });
  const startedAt = performance.now();
  await redis.set(auctionLockKey(auction.id), "held-by-demo-script", ["PX", "1500"]);
  const busyError = await expectAppError(() =>
    placeBid(
      pool,
      auction.id,
      { userId: userIds[0]!, amount: 109, requestId: `${suffix}-busy` },
      { bidCoordinator }
    )
  );
  await redis.del(auctionLockKey(auction.id));
  const accepted = await placeBid(
    pool,
    auction.id,
    { userId: userIds[1]!, amount: 109, requestId: `${suffix}-after-busy` },
    { bidCoordinator }
  );

  return {
    auctionId: auction.id,
    attempts: 2,
    accepted: accepted.bid.accepted ? 1 : 0,
    rejected: 1,
    duplicate: 0,
    lockBusy: busyError.code === "LOCK_BUSY" ? 1 : 0,
    businessRejected: 0,
    durationMs: Math.round(performance.now() - startedAt)
  };
}

function summarizeSettledResults(
  results: Array<PromiseSettledResult<Awaited<ReturnType<typeof placeBid>>>>
): Omit<ModeResult, "auctionId" | "attempts" | "durationMs"> {
  let accepted = 0;
  let rejected = 0;
  let lockBusy = 0;
  let businessRejected = 0;
  let duplicate = 0;

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.bid.accepted && !result.value.idempotentReplay) {
      accepted += 1;
      continue;
    }

    if (result.status === "fulfilled" && result.value.idempotentReplay) {
      duplicate += 1;
      continue;
    }

    rejected += 1;
    const error = result.status === "rejected" ? result.reason : null;
    if (error instanceof AppError && error.code === "LOCK_BUSY") {
      lockBusy += 1;
    } else if (error instanceof AppError && error.code === "DUPLICATE_PROCESSING") {
      duplicate += 1;
      rejected -= 1;
    } else {
      businessRejected += 1;
    }
  }

  return { accepted, rejected, lockBusy, businessRejected, duplicate };
}

async function expectAppError(action: () => Promise<unknown>): Promise<AppError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected action to throw AppError.");
}

async function printAndAssert(
  pool: Pool,
  mode: Mode,
  redisPong: string,
  result: ModeResult
): Promise<void> {
  const finalAuction = await findAuctionById(pool, result.auctionId);
  const orderCount = await countRows(pool, "SELECT COUNT(*) AS count FROM orders WHERE auction_id = ?", [
    result.auctionId
  ]);
  const acceptedBidRows = await countRows(
    pool,
    "SELECT COUNT(*) AS count FROM bids WHERE auction_id = ? AND accepted = TRUE",
    [result.auctionId]
  );
  const rejectedBidRows = await countRows(
    pool,
    "SELECT COUNT(*) AS count FROM bids WHERE auction_id = ? AND accepted = FALSE",
    [result.auctionId]
  );
  const lockBusyBidRows = await countRows(
    pool,
    "SELECT COUNT(*) AS count FROM bids WHERE auction_id = ? AND reject_reason = 'lock_busy'",
    [result.auctionId]
  );
  const rejectedEventRows = await countRows(
    pool,
    "SELECT COUNT(*) AS count FROM auction_events WHERE auction_id = ? AND event_type = 'bid.rejected'",
    [result.auctionId]
  );
  const acceptedEventRows = await countRows(
    pool,
    "SELECT COUNT(*) AS count FROM auction_events WHERE auction_id = ? AND event_type = 'bid.accepted'",
    [result.auctionId]
  );
  const [eventRows] = await pool.execute<EventCountRow[]>(
    `SELECT event_type, COUNT(*) AS event_count
     FROM auction_events
     WHERE auction_id = ?
     GROUP BY event_type
     ORDER BY event_type`,
    [result.auctionId]
  );

  console.log(`mode=${mode}`);
  console.log(`redis=${redisPong}`);
  console.log(`auctionId=${result.auctionId}`);
  console.log(`attempts=${result.attempts}`);
  console.log(`accepted=${result.accepted}`);
  console.log(`rejected=${result.rejected}`);
  console.log(`duplicate=${result.duplicate}`);
  console.log(`lockBusy=${result.lockBusy}`);
  console.log(`businessRejected=${result.businessRejected}`);
  console.log(`durationMs=${result.durationMs}`);
  console.log(`finalStatus=${finalAuction.status}`);
  console.log(`finalPrice=${finalAuction.currentPrice}`);
  console.log(`finalWinnerId=${finalAuction.currentWinnerId ?? "null"}`);
  console.log(`orderCount=${orderCount}`);
  console.log(`acceptedBidRows=${acceptedBidRows}`);
  console.log(`rejectedBidRows=${rejectedBidRows}`);
  console.log(`lockBusyBidRows=${lockBusyBidRows}`);
  console.log(`acceptedEventRows=${acceptedEventRows}`);
  console.log(`rejectedEventRows=${rejectedEventRows}`);
  console.log(
    `eventCounts=${eventRows
      .map((row) => `${row.event_type}:${Number(row.event_count)}`)
      .join(",")}`
  );

  assertModeResult(mode, result, finalAuction, {
    orderCount,
    acceptedBidRows,
    rejectedBidRows,
    lockBusyBidRows,
    acceptedEventRows,
    rejectedEventRows
  });
}

function assertModeResult(
  mode: Mode,
  result: ModeResult,
  finalAuction: AuctionDto,
  rows: {
    orderCount: number;
    acceptedBidRows: number;
    rejectedBidRows: number;
    lockBusyBidRows: number;
    acceptedEventRows: number;
    rejectedEventRows: number;
  }
): void {
  if (mode === "unique") {
    if (
      result.attempts !== UNIQUE_ATTEMPTS ||
      result.accepted !== 1 ||
      result.rejected !== 99 ||
      finalAuction.status !== "Sold" ||
      finalAuction.currentPrice !== 109 ||
      rows.orderCount !== 1 ||
      rows.acceptedBidRows !== 1 ||
      rows.rejectedBidRows !== 99 ||
      rows.rejectedEventRows !== 99 ||
      rows.lockBusyBidRows !== result.lockBusy
    ) {
      throw new Error(`Concurrency demo assertions failed for mode=${mode} auctionId=${result.auctionId}.`);
    }
    return;
  }

  if (mode === "duplicate-accepted") {
    if (
      result.accepted !== 1 ||
      result.duplicate !== DUPLICATE_ATTEMPTS - 1 ||
      rows.acceptedBidRows !== 1 ||
      rows.acceptedEventRows !== 1 ||
      finalAuction.currentPrice !== 109
    ) {
      throw new Error(`Concurrency demo assertions failed for mode=${mode} auctionId=${result.auctionId}.`);
    }
    return;
  }

  if (mode === "duplicate-rejected") {
    if (
      result.businessRejected !== 1 ||
      result.duplicate !== DUPLICATE_ATTEMPTS - 1 ||
      rows.rejectedBidRows !== 1 ||
      rows.rejectedEventRows !== 1 ||
      finalAuction.currentPrice !== 99
    ) {
      throw new Error(`Concurrency demo assertions failed for mode=${mode} auctionId=${result.auctionId}.`);
    }
    return;
  }

  if (
    result.accepted !== 1 ||
    result.lockBusy !== 1 ||
    rows.lockBusyBidRows !== 1 ||
    rows.rejectedBidRows !== 1 ||
    rows.rejectedEventRows !== 1 ||
    rows.acceptedBidRows !== 1 ||
    finalAuction.currentPrice !== 109
  ) {
    throw new Error(`Concurrency demo assertions failed for mode=${mode} auctionId=${result.auctionId}.`);
  }
}

async function main(): Promise<void> {
  const mode = parseMode();
  const pool = createDbPool();
  const redis = createRedisClient();
  const bidCoordinator = createRedisBidCoordinator(redis);
  let auctionId: number | null = null;

  try {
    const redisPong = await redis.ping();
    const userIds = await ensureLoadUsers(pool);
    const suffix = `node3-concurrency-${mode}-${Date.now()}-${Math.round(Math.random() * 100000)}`;
    const result =
      mode === "unique"
        ? await runUniqueMode(pool, bidCoordinator, userIds, suffix)
        : mode === "duplicate-accepted"
          ? await runDuplicateAcceptedMode(pool, bidCoordinator, userIds[0]!, suffix)
          : mode === "duplicate-rejected"
            ? await runDuplicateRejectedMode(pool, bidCoordinator, userIds[0]!, suffix)
            : await runLockBusyMode(pool, redis, bidCoordinator, userIds, suffix);
    auctionId = result.auctionId;
    await printAndAssert(pool, mode, redisPong, result);
  } catch (error) {
    console.error(`demo:concurrency failed mode=${mode} auctionId=${auctionId ?? "not-created"}`);
    throw error;
  } finally {
    await redis.close();
    await pool.end();
  }
}

await main();
