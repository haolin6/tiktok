import {
  assertAuctionStatusTransition,
  isTerminalAuctionStatus,
  type AuctionExtensionDto,
  type AuctionDetailResponse,
  type AuctionDto,
  type AuctionListResponse,
  type AuctionSnapshotResponse,
  type BidDto,
  type CancelAuctionRequest,
  type CreateAuctionRequest,
  type PlaceBidRequest,
  type PlaceBidResponse
} from "@live-auction/shared";
import type { DbPool } from "../db/pool.js";
import type { DbExecutor } from "../db/executor.js";
import { AppError, conflict, validationError } from "../errors.js";
import {
  findAuctionById,
  findAuctionByIdForUpdate,
  insertAuction,
  listDueRunningAuctions,
  listAuctions,
  updateAuctionCurrentBid,
  updateAuctionEndAt,
  updateAuctionStatus
} from "../repositories/auctions-repository.js";
import {
  findBidById,
  findBidByRequest,
  insertBid,
  listBidRanking,
  listRecentAcceptedBids
} from "../repositories/bids-repository.js";
import { insertAuctionEvent } from "../repositories/events-repository.js";
import { findOrderByAuctionId, insertOrderIfMissing } from "../repositories/orders-repository.js";
import { findProductById } from "../repositories/products-repository.js";
import { findRoomById } from "../repositories/rooms-repository.js";
import { findDefaultStreamerId, findUserById, userExists } from "../repositories/users-repository.js";
import {
  createRedisBidCoordinator,
  type AuctionLock,
  type BidCoordinator
} from "./bid-coordinator.js";

interface PlaceBidOptions {
  bidCoordinator?: BidCoordinator;
}

type BidProcessingResult =
  | { kind: "accepted"; response: PlaceBidResponse }
  | { kind: "rejected"; bid: BidDto; message: string };

function parseRequiredDate(value: string, fieldName: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw validationError(`${fieldName} must be an ISO date string.`);
  }

  return date;
}

function assertPositiveNumber(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw validationError(`${fieldName} must be greater than 0.`);
  }
}

function assertNonNegativeNumber(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw validationError(`${fieldName} must be greater than or equal to 0.`);
  }
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

function fromCents(value: number): number {
  return value / 100;
}

function calculateNextBidAmount(auction: AuctionDto): number | null {
  if (auction.status !== "Running") {
    return null;
  }

  if (auction.ceilingPrice !== null && toCents(auction.currentPrice) >= toCents(auction.ceilingPrice)) {
    return null;
  }

  const nextCents = toCents(auction.currentPrice) + toCents(auction.incrementStep);
  if (auction.ceilingPrice === null) {
    return fromCents(nextCents);
  }

  return fromCents(Math.min(nextCents, toCents(auction.ceilingPrice)));
}

function hasAuctionEnded(auction: AuctionDto, now: Date): boolean {
  return new Date(auction.endAt).getTime() <= now.getTime();
}

function isCeilingReached(auction: AuctionDto): boolean {
  return auction.ceilingPrice !== null && toCents(auction.currentPrice) >= toCents(auction.ceilingPrice);
}

async function findBidderOrThrow(db: DbExecutor, userId: number) {
  try {
    const user = await findUserById(db, userId);
    if (user.role !== "bidder") {
      throw validationError(`User ${userId} is not allowed to place bids.`);
    }

    return user;
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") {
      throw validationError(`User ${userId} does not exist.`);
    }

    throw error;
  }
}

async function recordRejectedBid(
  db: DbExecutor,
  auctionId: number,
  input: PlaceBidRequest,
  reason: string
): Promise<BidDto> {
  const bid = await insertBid(db, {
    auctionId,
    userId: input.userId,
    amount: input.amount,
    requestId: input.requestId.trim(),
    accepted: false,
    rejectReason: reason
  });

  await insertAuctionEvent(db, {
    auctionId,
    eventType: "bid.rejected",
    payload: {
      auctionId,
      bidId: bid.id,
      userId: input.userId,
      amount: input.amount,
      requestId: input.requestId.trim(),
      reason
    }
  });

  return bid;
}

async function recordRejectedBidWithTransaction(
  pool: DbPool,
  auctionId: number,
  input: PlaceBidRequest,
  reason: string
): Promise<BidDto> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const bid = await recordRejectedBid(connection, auctionId, input, reason);
    await connection.commit();
    return bid;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function maybeExtendAuction(
  db: DbExecutor,
  auction: AuctionDto,
  now: Date,
  triggerBidId: number
): Promise<{ auction: AuctionDto; extension: AuctionExtensionDto | null }> {
  if (auction.status !== "Running" || isCeilingReached(auction)) {
    return { auction, extension: null };
  }

  const previousEndAt = new Date(auction.endAt);
  const remainingMs = previousEndAt.getTime() - now.getTime();
  if (remainingMs > auction.extendThresholdSec * 1_000) {
    return { auction, extension: null };
  }

  const baseTime = Math.max(previousEndAt.getTime(), now.getTime());
  const newEndAt = new Date(baseTime + auction.extendDurationSec * 1_000);
  const extendedAuction = await updateAuctionEndAt(db, auction.id, newEndAt);
  const extension: AuctionExtensionDto = {
    auctionId: auction.id,
    previousEndAt: previousEndAt.toISOString(),
    newEndAt: newEndAt.toISOString(),
    extendDurationSec: auction.extendDurationSec,
    triggerBidId
  };

  await insertAuctionEvent(db, {
    auctionId: auction.id,
    eventType: "auction.extended",
    payload: { ...extension }
  });

  return {
    auction: extendedAuction,
    extension
  };
}

async function settleLockedRunningAuction(
  db: DbExecutor,
  auction: AuctionDto,
  reason: "ceiling" | "ended"
): Promise<AuctionDto> {
  if (auction.status !== "Running") {
    return auction;
  }

  const shouldSettle = reason === "ceiling" ? isCeilingReached(auction) : true;
  if (!shouldSettle) {
    return auction;
  }

  if (auction.currentWinnerId !== null) {
    const winnerId = auction.currentWinnerId;
    assertAuctionStatusTransition(auction.status, "Sold");
    const soldAuction = await updateAuctionStatus(db, auction.id, auction.status, "Sold");
    const order = await insertOrderIfMissing(db, {
      auctionId: soldAuction.id,
      productId: soldAuction.productId,
      buyerId: winnerId,
      amount: soldAuction.currentPrice
    });

    await insertAuctionEvent(db, {
      auctionId: soldAuction.id,
      eventType: "auction.sold",
      payload: {
        auctionId: soldAuction.id,
        orderId: order.id,
        buyerId: order.buyerId,
        amount: order.amount,
        reason
      }
    });

    await insertAuctionEvent(db, {
      auctionId: soldAuction.id,
      eventType: "order.created",
      payload: {
        auctionId: soldAuction.id,
        orderId: order.id,
        buyerId: order.buyerId,
        amount: order.amount
      }
    });

    return soldAuction;
  }

  assertAuctionStatusTransition(auction.status, "Passed");
  const passedAuction = await updateAuctionStatus(db, auction.id, auction.status, "Passed");
  await insertAuctionEvent(db, {
    auctionId: passedAuction.id,
    eventType: "auction.passed",
    payload: {
      auctionId: passedAuction.id,
      reason
    }
  });

  return passedAuction;
}

export async function createAuction(
  pool: DbPool,
  input: CreateAuctionRequest
): Promise<AuctionDto> {
  assertNonNegativeNumber(input.startPrice, "startPrice");
  assertPositiveNumber(input.incrementStep, "incrementStep");

  if (input.ceilingPrice !== undefined && input.ceilingPrice !== null) {
    assertNonNegativeNumber(input.ceilingPrice, "ceilingPrice");
    if (input.ceilingPrice < input.startPrice) {
      throw validationError("ceilingPrice must be greater than or equal to startPrice.");
    }
  }

  const startAt = parseRequiredDate(input.startAt, "startAt");
  const endAt = parseRequiredDate(input.endAt, "endAt");
  if (endAt.getTime() <= startAt.getTime()) {
    throw validationError("endAt must be later than startAt.");
  }

  const extendThresholdSec = input.extendThresholdSec ?? 10;
  const extendDurationSec = input.extendDurationSec ?? 10;
  assertPositiveNumber(extendThresholdSec, "extendThresholdSec");
  assertPositiveNumber(extendDurationSec, "extendDurationSec");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const createdBy = input.createdBy ?? (await findDefaultStreamerId(connection));
    if (input.createdBy && !(await userExists(connection, input.createdBy))) {
      throw validationError(`User ${input.createdBy} does not exist.`);
    }

    await findRoomById(connection, input.roomId);
    await findProductById(connection, input.productId);

    const auction = await insertAuction(connection, {
      roomId: input.roomId,
      productId: input.productId,
      startPrice: input.startPrice,
      incrementStep: input.incrementStep,
      ceilingPrice: input.ceilingPrice ?? null,
      startAt,
      endAt,
      extendThresholdSec,
      extendDurationSec,
      createdBy
    });

    await insertAuctionEvent(connection, {
      auctionId: auction.id,
      eventType: "auction.created",
      payload: {
        auctionId: auction.id,
        roomId: auction.roomId,
        productId: auction.productId,
        status: auction.status,
        createdBy
      }
    });

    await connection.commit();
    return auction;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getAuctionDetail(
  pool: DbPool,
  auctionId: number
): Promise<AuctionDetailResponse> {
  return {
    auction: await findAuctionById(pool, auctionId)
  };
}

export async function getAuctionList(pool: DbPool): Promise<AuctionListResponse> {
  return {
    items: await listAuctions(pool)
  };
}

export async function getAuctionSnapshot(
  pool: DbPool,
  auctionId: number
): Promise<AuctionSnapshotResponse> {
  const auction = await settleAuctionIfNeeded(pool, auctionId);
  const [product, room, currentWinner, recentBids, order] = await Promise.all([
    findProductById(pool, auction.productId),
    findRoomById(pool, auction.roomId),
    auction.currentWinnerId === null ? Promise.resolve(null) : findUserById(pool, auction.currentWinnerId),
    listRecentAcceptedBids(pool, auction.id),
    findOrderByAuctionId(pool, auction.id)
  ]);

  return {
    auction,
    product,
    room,
    currentPrice: auction.currentPrice,
    nextBidAmount: calculateNextBidAmount(auction),
    currentWinner,
    recentBids,
    order,
    serverTime: new Date().toISOString()
  };
}

export async function getAuctionSnapshotWithSettlementSignal(
  pool: DbPool,
  auctionId: number
): Promise<{ snapshot: AuctionSnapshotResponse; settledBySnapshot: boolean }> {
  const before = await findAuctionById(pool, auctionId);
  const snapshot = await getAuctionSnapshot(pool, auctionId);
  const settledBySnapshot =
    before.status === "Running" &&
    (snapshot.auction.status === "Sold" || snapshot.auction.status === "Passed");

  return { snapshot, settledBySnapshot };
}

export async function getAuctionBidStreams(
  pool: DbPool,
  auctionId: number
): Promise<{ recentBids: BidDto[]; ranking: BidDto[] }> {
  const [recentBids, ranking] = await Promise.all([
    listRecentAcceptedBids(pool, auctionId),
    listBidRanking(pool, auctionId)
  ]);

  return { recentBids, ranking };
}

export async function startAuction(pool: DbPool, auctionId: number): Promise<AuctionDto> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const auction = await findAuctionByIdForUpdate(connection, auctionId);
    if (auction.status === "Running") {
      await connection.commit();
      return auction;
    }

    try {
      assertAuctionStatusTransition(auction.status, "Running");
    } catch {
      throw conflict(`Auction ${auctionId} cannot be started from ${auction.status}.`);
    }

    if (hasAuctionEnded(auction, new Date())) {
      throw conflict(`Auction ${auctionId} has already passed its end time.`);
    }

    const updatedAuction = await updateAuctionStatus(connection, auctionId, auction.status, "Running");
    await insertAuctionEvent(connection, {
      auctionId,
      eventType: "auction.started",
      payload: {
        auctionId,
        previousStatus: auction.status,
        status: updatedAuction.status
      }
    });

    await connection.commit();
    return updatedAuction;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function placeBid(
  pool: DbPool,
  auctionId: number,
  input: PlaceBidRequest,
  options: PlaceBidOptions = {}
): Promise<PlaceBidResponse> {
  assertPositiveNumber(input.amount, "amount");
  const requestId = input.requestId.trim();
  if (!requestId) {
    throw validationError("requestId is required.");
  }

  await findBidderOrThrow(pool, input.userId);
  await findAuctionById(pool, auctionId);

  const bidCoordinator = options.bidCoordinator ?? createRedisBidCoordinator();
  const normalizedInput: PlaceBidRequest = { ...input, requestId };
  const requestState = await bidCoordinator.beginBidRequest({
    auctionId,
    userId: input.userId,
    requestId
  });

  if (requestState.kind === "accepted") {
    return responseFromExistingBid(pool, auctionId, requestState.bidId);
  }

  if (requestState.kind === "rejected") {
    throw conflict(requestState.reason);
  }

  if (requestState.kind === "processing") {
    throw new AppError(409, "DUPLICATE_PROCESSING", "Bid request is already processing.");
  }

  let lock: AuctionLock | null = null;
  let requestFinalized = false;

  try {
    lock = await bidCoordinator.acquireAuctionLock(auctionId);
    if (!lock) {
      const rejectedBid = await recordRejectedBidWithTransaction(
        pool,
        auctionId,
        normalizedInput,
        "lock_busy"
      );
      await bidCoordinator.finalizeBidRequest({
        auctionId,
        userId: input.userId,
        requestId,
        bid: rejectedBid
      });
      requestFinalized = true;
      throw new AppError(409, "LOCK_BUSY", "Auction is busy. Please retry.");
    }

    const result = await processBidWithMysqlLock(pool, auctionId, normalizedInput);
    if (result.kind === "rejected") {
      await bidCoordinator.finalizeBidRequest({
        auctionId,
        userId: input.userId,
        requestId,
        bid: result.bid
      });
      requestFinalized = true;
      throw conflict(result.message);
    }

    await bidCoordinator.finalizeBidRequest({
      auctionId,
      userId: input.userId,
      requestId,
      bid: result.response.bid
    });
    requestFinalized = true;
    await bidCoordinator.writeAcceptedBidState({
      auctionId,
      bid: result.response.bid,
      auctionState: result.response.snapshot
    });

    return result.response;
  } catch (error) {
    if (
      requestState.kind === "started" &&
      !requestFinalized &&
      !(error instanceof AppError && error.code === "LOCK_BUSY")
    ) {
      await bidCoordinator.clearBidRequest({ auctionId, userId: input.userId, requestId });
    }

    throw error;
  } finally {
    if (lock) {
      await bidCoordinator.releaseAuctionLock(lock);
    }
  }
}

async function responseFromExistingBid(
  pool: DbPool,
  auctionId: number,
  bidId: number
): Promise<PlaceBidResponse> {
  const bid = await findBidById(pool, bidId);
  if (!bid.accepted) {
    throw conflict(bid.rejectReason ?? "Bid request was rejected.");
  }

  return {
    bid,
    auction: await findAuctionById(pool, auctionId),
    snapshot: await getAuctionSnapshot(pool, auctionId),
    extension: null,
    idempotentReplay: true
  };
}

async function processBidWithMysqlLock(
  pool: DbPool,
  auctionId: number,
  input: PlaceBidRequest
): Promise<BidProcessingResult> {
  const connection = await pool.getConnection();
  let committed = false;

  try {
    await connection.beginTransaction();

    let auction = await findAuctionByIdForUpdate(connection, auctionId);
    const existingBid = await findBidByRequest(connection, auctionId, input.userId, input.requestId);
    if (existingBid) {
      await connection.commit();
      committed = true;
      if (existingBid.accepted) {
        return {
          kind: "accepted",
          response: {
            bid: existingBid,
            auction,
            snapshot: await getAuctionSnapshot(pool, auctionId),
            extension: null,
            idempotentReplay: true
          }
        };
      }

      return {
        kind: "rejected",
        bid: existingBid,
        message: existingBid.rejectReason ?? "Bid request was rejected."
      };
    }

    const now = new Date();

    if (auction.status === "Running" && hasAuctionEnded(auction, now)) {
      const rejectedBid = await recordRejectedBid(connection, auctionId, input, "Auction has ended.");
      auction = await settleLockedRunningAuction(connection, auction, "ended");
      await connection.commit();
      committed = true;
      return {
        kind: "rejected",
        bid: rejectedBid,
        message: `Auction ${auction.id} has ended.`
      };
    }

    if (auction.status !== "Running") {
      const reason = isTerminalAuctionStatus(auction.status)
        ? `Auction is already ${auction.status}.`
        : `Auction is ${auction.status} and cannot accept bids.`;
      const rejectedBid = await recordRejectedBid(connection, auctionId, input, reason);
      await connection.commit();
      committed = true;
      return { kind: "rejected", bid: rejectedBid, message: reason };
    }

    const nextBidAmount = calculateNextBidAmount(auction);
    if (nextBidAmount === null || toCents(input.amount) !== toCents(nextBidAmount)) {
      const reason =
        nextBidAmount === null
          ? "Auction cannot accept another bid."
          : `Bid amount must be exactly ${nextBidAmount}.`;
      const rejectedBid = await recordRejectedBid(connection, auctionId, input, reason);
      await connection.commit();
      committed = true;
      return { kind: "rejected", bid: rejectedBid, message: reason };
    }

    const acceptedBid = await insertBid(connection, {
      auctionId,
      userId: input.userId,
      amount: nextBidAmount,
      requestId: input.requestId,
      accepted: true,
      rejectReason: null
    });

    const previousWinnerId = auction.currentWinnerId;
    auction = await updateAuctionCurrentBid(connection, auctionId, nextBidAmount, input.userId);
    await insertAuctionEvent(connection, {
      auctionId,
      eventType: "bid.accepted",
      payload: {
        auctionId,
        bidId: acceptedBid.id,
        userId: input.userId,
        amount: nextBidAmount,
        requestId: input.requestId,
        previousWinnerId
      }
    });

    const extensionResult = await maybeExtendAuction(connection, auction, now, acceptedBid.id);
    auction = extensionResult.auction;
    const finalAuction = isCeilingReached(auction)
      ? await settleLockedRunningAuction(connection, auction, "ceiling")
      : auction;

    await connection.commit();
    committed = true;

    return {
      kind: "accepted",
      response: {
        bid: acceptedBid,
        auction: finalAuction,
        snapshot: await getAuctionSnapshot(pool, auctionId),
        extension: extensionResult.extension,
        idempotentReplay: false
      }
    };
  } catch (error) {
    if (!committed) {
      await connection.rollback();
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function settleAuctionIfNeeded(
  pool: DbPool,
  auctionId: number
): Promise<AuctionDto> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let auction = await findAuctionByIdForUpdate(connection, auctionId);
    const now = new Date();
    if (auction.status === "Running" && hasAuctionEnded(auction, now)) {
      auction = await settleLockedRunningAuction(connection, auction, "ended");
    }

    await connection.commit();
    return auction;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function settleDueRunningAuctions(pool: DbPool): Promise<void> {
  const dueAuctions = await listDueRunningAuctions(pool, new Date());
  for (const auction of dueAuctions) {
    await settleAuctionIfNeeded(pool, auction.id);
  }
}

export async function cancelAuction(
  pool: DbPool,
  auctionId: number,
  input: CancelAuctionRequest
): Promise<AuctionDto> {
  const reason = input.reason.trim();
  if (!reason) {
    throw validationError("Cancel reason is required.");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const auction = await findAuctionById(connection, auctionId);
    try {
      assertAuctionStatusTransition(auction.status, "Canceled");
    } catch {
      throw conflict(`Auction ${auctionId} cannot be canceled from ${auction.status}.`);
    }

    const updatedAuction = await updateAuctionStatus(
      connection,
      auctionId,
      auction.status,
      "Canceled"
    );

    await insertAuctionEvent(connection, {
      auctionId,
      eventType: "auction.canceled",
      payload: {
        auctionId,
        previousStatus: auction.status,
        status: updatedAuction.status,
        reason
      }
    });

    await connection.commit();
    return updatedAuction;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
