import { randomUUID } from "node:crypto";
import type { BidDto } from "@live-auction/shared";
import { createRedisClient, type RedisCommandClient } from "../repositories/redis-client.js";

const BID_REQUEST_TTL_MS = 300_000;
const BID_LOCK_TTL_MS = 2_500;
const LOCK_RETRY_COUNT = 5;
const LOCK_RETRY_BASE_MS = 25;
const LOCK_RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export type BidRequestState =
  | { kind: "started" }
  | { kind: "processing" }
  | { kind: "accepted"; bidId: number }
  | { kind: "rejected"; bidId: number | null; reason: string };

export interface AuctionLock {
  key: string;
  token: string;
}

export interface BidCoordinator {
  beginBidRequest(input: {
    auctionId: number;
    userId: number;
    requestId: string;
  }): Promise<BidRequestState>;
  finalizeBidRequest(input: {
    auctionId: number;
    userId: number;
    requestId: string;
    bid: BidDto;
  }): Promise<void>;
  clearBidRequest(input: { auctionId: number; userId: number; requestId: string }): Promise<void>;
  acquireAuctionLock(auctionId: number): Promise<AuctionLock | null>;
  releaseAuctionLock(lock: AuctionLock): Promise<void>;
  writeAcceptedBidState(input: { auctionId: number; bid: BidDto; auctionState: unknown }): Promise<void>;
}

function bidRequestKey(auctionId: number, userId: number, requestId: string): string {
  return `auction:${auctionId}:user:${userId}:request:${requestId}`;
}

function auctionLockKey(auctionId: number): string {
  return `auction:${auctionId}:lock`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseBidRequestState(value: string | null): BidRequestState {
  if (!value || value === "processing") {
    return { kind: "processing" };
  }

  const [kind, bidId, ...reasonParts] = value.split(":");
  if (kind === "accepted" && bidId) {
    return { kind: "accepted", bidId: Number(bidId) };
  }

  if (kind === "rejected") {
    return {
      kind: "rejected",
      bidId: bidId ? Number(bidId) : null,
      reason: reasonParts.join(":") || "Bid request was rejected."
    };
  }

  return { kind: "processing" };
}

export class RedisBidCoordinator implements BidCoordinator {
  constructor(private readonly redis: RedisCommandClient = createRedisClient()) {}

  async beginBidRequest(input: {
    auctionId: number;
    userId: number;
    requestId: string;
  }): Promise<BidRequestState> {
    const key = bidRequestKey(input.auctionId, input.userId, input.requestId);
    const result = await this.redis.set(key, "processing", [
      "NX",
      "PX",
      String(BID_REQUEST_TTL_MS)
    ]);

    if (result === "OK") {
      return { kind: "started" };
    }

    return parseBidRequestState(await this.redis.get(key));
  }

  async finalizeBidRequest(input: {
    auctionId: number;
    userId: number;
    requestId: string;
    bid: BidDto;
  }): Promise<void> {
    const key = bidRequestKey(input.auctionId, input.userId, input.requestId);
    const value = input.bid.accepted
      ? `accepted:${input.bid.id}`
      : `rejected:${input.bid.id}:${input.bid.rejectReason ?? "rejected"}`;
    await this.redis.set(key, value, ["PX", String(BID_REQUEST_TTL_MS)]);
  }

  async clearBidRequest(input: { auctionId: number; userId: number; requestId: string }): Promise<void> {
    await this.redis.del(bidRequestKey(input.auctionId, input.userId, input.requestId));
  }

  async acquireAuctionLock(auctionId: number): Promise<AuctionLock | null> {
    const key = auctionLockKey(auctionId);
    for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
      const token = randomUUID();
      const result = await this.redis.set(key, token, ["NX", "PX", String(BID_LOCK_TTL_MS)]);
      if (result === "OK") {
        return { key, token };
      }

      const jitter = Math.trunc(Math.random() * 26);
      await delay(LOCK_RETRY_BASE_MS + jitter);
    }

    return null;
  }

  async releaseAuctionLock(lock: AuctionLock): Promise<void> {
    await this.redis.eval(LOCK_RELEASE_SCRIPT, [lock.key], [lock.token]);
  }

  async writeAcceptedBidState(input: {
    auctionId: number;
    bid: BidDto;
    auctionState: unknown;
  }): Promise<void> {
    await this.redis.set(
      `auction:${input.auctionId}:state`,
      JSON.stringify(input.auctionState),
      ["PX", String(BID_REQUEST_TTL_MS)]
    );
    await this.redis.command([
      "ZADD",
      `auction:${input.auctionId}:bids`,
      String(input.bid.amount),
      String(input.bid.id)
    ]);
  }
}

export function createRedisBidCoordinator(redis?: RedisCommandClient): BidCoordinator {
  return new RedisBidCoordinator(redis);
}
