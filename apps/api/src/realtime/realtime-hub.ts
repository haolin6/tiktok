import type { Server } from "node:http";
import type { RowDataPacket } from "mysql2";
import { Server as SocketIOServer, type Socket } from "socket.io";
import type {
  AuctionCanceledPayload,
  AuctionDto,
  AuctionSnapshotResponse,
  BidPlacePayload,
  BidRejectedPayload,
  OrderPaidPayload,
  OrderSummaryDto,
  PlaceBidResponse,
  RealtimeAck,
  RealtimeClientMessage,
  RealtimePayloadByEvent,
  RealtimeServerEvent,
  RealtimeServerEventType
} from "@live-auction/shared";
import type { DbPool } from "../db/pool.js";
import { AppError, validationError } from "../errors.js";
import { findAuctionById } from "../repositories/auctions-repository.js";
import { createRedisClient, type RedisCommandClient } from "../repositories/redis-client.js";
import { findRoomById } from "../repositories/rooms-repository.js";
import { findUserById } from "../repositories/users-repository.js";
import {
  getAuctionBidStreams,
  getAuctionSnapshot,
  placeBid
} from "../services/auctions-service.js";
import {
  createRedisBidCoordinator,
  type BidCoordinator
} from "../services/bid-coordinator.js";

type AckCallback = (ack: RealtimeAck) => void;

interface EventPayloadRow extends RowDataPacket {
  payload_json: string | AuctionCanceledPayload;
}

export interface RealtimeHub {
  attach(server: Server): void;
  close(): Promise<void>;
  publishAuctionSnapshot(auctionId: number): Promise<void>;
  publishBidAccepted(response: PlaceBidResponse): Promise<void>;
  publishAuctionSettled(snapshot: AuctionSnapshotResponse, reason: "ended"): Promise<void>;
  publishAuctionCanceled(auction: AuctionDto, reason: string): Promise<void>;
  publishOrderPaid(order: OrderSummaryDto): Promise<void>;
}

function auctionRoomName(auctionId: number): string {
  return `auction:${auctionId}`;
}

function liveRoomName(roomId: number): string {
  return `room:${roomId}`;
}

function userRoomName(userId: number): string {
  return `user:${userId}`;
}

function roomOnlineUsersKey(roomId: number): string {
  return `room:${roomId}:online`;
}

function roomUserSocketsKey(roomId: number, userId: number): string {
  return `room:${roomId}:user:${userId}:sockets`;
}

function parsePositiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw validationError(`${field} must be a positive integer.`);
  }

  return parsed;
}

function parsePositiveNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw validationError(`${field} must be greater than 0.`);
  }

  return parsed;
}

function appErrorToAck(error: unknown): RealtimeAck {
  if (error instanceof AppError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message
      }
    };
  }

  return {
    ok: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected server error."
    }
  };
}

function safeAck(ack: AckCallback | undefined, value: RealtimeAck): void {
  if (ack) {
    ack(value);
  }
}

export function createNoopRealtimeHub(): RealtimeHub {
  return {
    attach() {},
    async close() {},
    async publishAuctionSnapshot() {},
    async publishBidAccepted() {},
    async publishAuctionSettled() {},
    async publishAuctionCanceled() {},
    async publishOrderPaid() {}
  };
}

export function createRealtimeHub(
  pool: DbPool,
  options: {
    redis?: RedisCommandClient;
    bidCoordinator?: BidCoordinator;
  } = {}
): RealtimeHub {
  return new SocketIoRealtimeHub(
    pool,
    options.redis ?? createRedisClient(),
    options.bidCoordinator ?? createRedisBidCoordinator()
  );
}

class SocketIoRealtimeHub implements RealtimeHub {
  private io: SocketIOServer | null = null;
  private serverSeq = 0;

  constructor(
    private readonly pool: DbPool,
    private readonly redis: RedisCommandClient,
    private readonly bidCoordinator: BidCoordinator
  ) {}

  attach(server: Server): void {
    if (this.io) {
      return;
    }

    this.io = new SocketIOServer(server, {
      cors: {
        origin: ["http://localhost:3000", "http://127.0.0.1:3000"]
      }
    });

    this.io.on("connection", (socket) => {
      this.registerSocket(socket);
    });
  }

  async close(): Promise<void> {
    if (this.io) {
      await this.io.close();
      this.io = null;
    }
    await this.redis.close();
  }

  async publishAuctionSnapshot(auctionId: number): Promise<void> {
    const snapshot = await getAuctionSnapshot(this.pool, auctionId);
    this.emitToRoom(
      auctionRoomName(auctionId),
      this.makeEvent("auction.snapshot", {
        auctionId,
        roomId: snapshot.auction.roomId,
        payload: snapshot
      })
    );
  }

  async publishBidAccepted(response: PlaceBidResponse): Promise<void> {
    const roomId = response.snapshot.auction.roomId;
    this.emitToRoom(
      auctionRoomName(response.bid.auctionId),
      this.makeEvent("bid.accepted", {
        auctionId: response.bid.auctionId,
        roomId,
        payload: {
          auctionId: response.bid.auctionId,
          bidId: response.bid.id,
          userId: response.bid.userId,
          amount: response.bid.amount,
          requestId: response.bid.requestId,
          previousWinnerId: response.previousWinnerId
        }
      })
    );

    if (response.previousWinnerId !== null && response.previousWinnerId !== response.bid.userId) {
      this.emitToRoom(
        userRoomName(response.previousWinnerId),
        this.makeEvent("user.outbid", {
          auctionId: response.bid.auctionId,
          roomId,
          payload: {
            auctionId: response.bid.auctionId,
            previousWinnerId: response.previousWinnerId,
            newWinnerId: response.bid.userId,
            amount: response.bid.amount
          }
        })
      );
    }

    const streams = await getAuctionBidStreams(this.pool, response.bid.auctionId);
    this.emitToRoom(
      auctionRoomName(response.bid.auctionId),
      this.makeEvent("ranking.updated", {
        auctionId: response.bid.auctionId,
        roomId,
        payload: {
          auctionId: response.bid.auctionId,
          recentBids: streams.recentBids,
          ranking: streams.ranking
        }
      })
    );

    if (response.extension) {
      this.emitToRoom(
        auctionRoomName(response.bid.auctionId),
        this.makeEvent("auction.extended", {
          auctionId: response.bid.auctionId,
          roomId,
          payload: response.extension
        })
      );
    }

    if (response.auction.status === "Sold" && response.snapshot.order) {
      this.emitToRoom(
        auctionRoomName(response.bid.auctionId),
        this.makeEvent("auction.sold", {
          auctionId: response.bid.auctionId,
          roomId,
          payload: {
            auctionId: response.bid.auctionId,
            orderId: response.snapshot.order.id,
            buyerId: response.snapshot.order.buyerId,
            amount: response.snapshot.order.amount,
            reason: "ceiling"
          }
        })
      );
    }

    this.emitToRoom(
      auctionRoomName(response.bid.auctionId),
      this.makeEvent("auction.snapshot", {
        auctionId: response.bid.auctionId,
        roomId,
        payload: response.snapshot
      })
    );
  }

  async publishAuctionSettled(snapshot: AuctionSnapshotResponse, reason: "ended"): Promise<void> {
    const auction = snapshot.auction;
    const roomId = auction.roomId;

    if (auction.status === "Sold" && snapshot.order) {
      this.emitToRoom(
        auctionRoomName(auction.id),
        this.makeEvent("auction.sold", {
          auctionId: auction.id,
          roomId,
          payload: {
            auctionId: auction.id,
            orderId: snapshot.order.id,
            buyerId: snapshot.order.buyerId,
            amount: snapshot.order.amount,
            reason
          }
        })
      );
    }

    if (auction.status === "Passed") {
      this.emitToRoom(
        auctionRoomName(auction.id),
        this.makeEvent("auction.passed", {
          auctionId: auction.id,
          roomId,
          payload: {
            auctionId: auction.id,
            reason
          }
        })
      );
    }

    this.emitToRoom(
      auctionRoomName(auction.id),
      this.makeEvent("auction.snapshot", {
        auctionId: auction.id,
        roomId,
        payload: snapshot
      })
    );
  }

  async publishAuctionCanceled(auction: AuctionDto, reason: string): Promise<void> {
    const payload = await this.findLatestAuctionCanceledPayload(auction, reason);
    this.emitToRoom(
      auctionRoomName(auction.id),
      this.makeEvent("auction.canceled", {
        auctionId: auction.id,
        roomId: auction.roomId,
        payload
      })
    );
    await this.publishAuctionSnapshot(auction.id);
  }

  private async findLatestAuctionCanceledPayload(
    auction: AuctionDto,
    reason: string
  ): Promise<AuctionCanceledPayload> {
    const [rows] = await this.pool.execute<EventPayloadRow[]>(
      `SELECT payload_json
       FROM auction_events
       WHERE auction_id = ?
         AND event_type = 'auction.canceled'
       ORDER BY id DESC
       LIMIT 1`,
      [auction.id]
    );
    const payload = rows[0]?.payload_json;
    if (payload) {
      return typeof payload === "string" ? JSON.parse(payload) : payload;
    }

    return {
      auctionId: auction.id,
      previousStatus: "Running",
      status: "Canceled",
      reason
    };
  }

  async publishOrderPaid(order: OrderSummaryDto): Promise<void> {
    const payload: OrderPaidPayload = {
      auctionId: order.auctionId,
      roomId: order.auction.roomId,
      orderId: order.id,
      buyerId: order.buyerId,
      amount: order.amount,
      status: "paid",
      paidAt: order.updatedAt
    };
    this.emitToRoom(
      auctionRoomName(order.auctionId),
      this.makeEvent("order.paid", {
        auctionId: order.auctionId,
        roomId: order.auction.roomId,
        payload
      })
    );
    await this.publishAuctionSnapshot(order.auctionId);
  }

  private registerSocket(socket: Socket): void {
    socket.on("room.join", (payload: unknown, ack?: AckCallback) => {
      this.handleRoomJoin(socket, payload).then(
        (value) => safeAck(ack, { ok: true, payload: value }),
        (error) => safeAck(ack, appErrorToAck(error))
      );
    });

    socket.on("room.leave", (payload: unknown, ack?: AckCallback) => {
      this.handleRoomLeave(socket, payload).then(
        (value) => safeAck(ack, { ok: true, payload: value }),
        (error) => safeAck(ack, appErrorToAck(error))
      );
    });

    socket.on("auction.subscribe", (payload: unknown, ack?: AckCallback) => {
      this.handleAuctionSubscribe(socket, payload).then(
        (value) => safeAck(ack, { ok: true, payload: value }),
        (error) => safeAck(ack, appErrorToAck(error))
      );
    });

    socket.on("bid.place", (payload: unknown, ack?: AckCallback) => {
      this.handleBidPlace(socket, payload).then(
        (value) => safeAck(ack, { ok: true, payload: value }),
        (error) => safeAck(ack, appErrorToAck(error))
      );
    });

    socket.on("disconnect", () => {
      this.handleDisconnect(socket).catch(() => {});
    });
  }

  private async handleDisconnect(socket: Socket): Promise<void> {
    if (typeof socket.data.roomId === "number" && typeof socket.data.userId === "number") {
      await this.removePresence(socket.data.roomId, socket.data.userId, socket.id);
      await this.publishPresence(socket.data.roomId);
    }
  }

  private async handleRoomJoin(socket: Socket, rawPayload: unknown): Promise<{ roomId: number; userId: number }> {
    const message = { payload: rawPayload } as RealtimeClientMessage<"room.join">;
    const payload = message.payload as Record<string, unknown>;
    const roomId = parsePositiveInteger(payload.roomId, "roomId");
    const userId = parsePositiveInteger(payload.userId, "userId");
    const [room, user] = await Promise.all([
      findRoomById(this.pool, roomId),
      findUserById(this.pool, userId)
    ]);
    if (room.status !== "active") {
      throw validationError(`Room ${roomId} is inactive.`);
    }
    if (user.role !== "bidder") {
      throw validationError(`User ${userId} is not allowed to join as bidder.`);
    }

    if (typeof socket.data.roomId === "number" && typeof socket.data.userId === "number") {
      const previousRoomId = socket.data.roomId;
      const previousUserId = socket.data.userId;
      await socket.leave(liveRoomName(previousRoomId));
      await socket.leave(userRoomName(previousUserId));
      await this.removePresence(socket.data.roomId, socket.data.userId, socket.id);
      await this.publishPresence(previousRoomId);
    }

    await socket.join(liveRoomName(roomId));
    await socket.join(userRoomName(userId));
    socket.data.userId = userId;
    socket.data.roomId = roomId;
    await this.addPresence(roomId, userId, socket.id);
    await this.publishPresence(roomId);

    return { roomId, userId };
  }

  private async handleRoomLeave(socket: Socket, rawPayload: unknown): Promise<{ roomId: number }> {
    const message = { payload: rawPayload } as RealtimeClientMessage<"room.leave">;
    const payload = message.payload as Record<string, unknown>;
    const roomId = parsePositiveInteger(payload.roomId, "roomId");
    await socket.leave(liveRoomName(roomId));
    if (socket.data.roomId === roomId && typeof socket.data.userId === "number") {
      await socket.leave(userRoomName(socket.data.userId));
      await this.removePresence(roomId, socket.data.userId, socket.id);
      await this.publishPresence(roomId);
      socket.data.roomId = null;
      socket.data.userId = null;
    }

    return { roomId };
  }

  private async handleAuctionSubscribe(socket: Socket, rawPayload: unknown): Promise<{ auctionId: number }> {
    if (typeof socket.data.roomId !== "number") {
      throw validationError("room.join is required before auction.subscribe.");
    }

    const message = { payload: rawPayload } as RealtimeClientMessage<"auction.subscribe">;
    const payload = message.payload as Record<string, unknown>;
    const auctionId = parsePositiveInteger(payload.auctionId, "auctionId");
    const auction = await findAuctionById(this.pool, auctionId);
    if (auction.roomId !== socket.data.roomId) {
      throw validationError("Cannot subscribe to an auction in another room.");
    }

    await socket.join(auctionRoomName(auctionId));
    await this.sendAuctionSnapshot(socket, auctionId);
    return { auctionId };
  }

  private async handleBidPlace(socket: Socket, rawPayload: unknown): Promise<PlaceBidResponse> {
    if (typeof socket.data.userId !== "number" || typeof socket.data.roomId !== "number") {
      throw validationError("room.join is required before bid.place.");
    }

    const payload = rawPayload as BidPlacePayload;
    const auctionId = parsePositiveInteger(payload.auctionId, "auctionId");
    const amount = parsePositiveNumber(payload.amount, "amount");
    const requestId = String(payload.requestId ?? "").trim();
    if (!requestId) {
      throw validationError("requestId is required.");
    }
    if (payload.userId !== undefined && Number(payload.userId) !== socket.data.userId) {
      throw validationError("bid.place userId must match the joined socket user.");
    }

    const auction = await findAuctionById(this.pool, auctionId);
    if (auction.roomId !== socket.data.roomId) {
      throw validationError("Cannot place a bid in another room.");
    }

    try {
      const response = await placeBid(
        this.pool,
        auctionId,
        { userId: socket.data.userId, amount, requestId },
        { bidCoordinator: this.bidCoordinator }
      );
      if (!response.idempotentReplay) {
        await this.publishBidAccepted(response);
      }
      return response;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Bid was rejected.";
      const rejectedPayload: BidRejectedPayload = {
        auctionId,
        userId: socket.data.userId,
        amount,
        requestId,
        reason
      };
      socket.emit(
        "bid.rejected",
        this.makeEvent("bid.rejected", {
          auctionId,
          roomId: socket.data.roomId,
          payload: rejectedPayload
        })
      );
      throw error;
    }
  }

  private async sendAuctionSnapshot(socket: Socket, auctionId: number): Promise<void> {
    const snapshot = await getAuctionSnapshot(this.pool, auctionId);
    socket.emit(
      "auction.snapshot",
      this.makeEvent("auction.snapshot", {
        auctionId,
        roomId: snapshot.auction.roomId,
        payload: snapshot
      })
    );
  }

  private async publishPresence(roomId: number): Promise<void> {
    const onlineCountRaw = await this.redis.command(["SCARD", roomOnlineUsersKey(roomId)]);
    const onlineCount = typeof onlineCountRaw === "number" ? onlineCountRaw : 0;
    this.emitToRoom(
      liveRoomName(roomId),
      this.makeEvent("room.presence", {
        roomId,
        payload: {
          roomId,
          onlineCount
        }
      })
    );
  }

  private async addPresence(roomId: number, userId: number, socketId: string): Promise<void> {
    await this.redis.command(["SADD", roomUserSocketsKey(roomId, userId), socketId]);
    await this.redis.command(["SADD", roomOnlineUsersKey(roomId), String(userId)]);
  }

  private async removePresence(roomId: number, userId: number, socketId: string): Promise<void> {
    const userSocketsKey = roomUserSocketsKey(roomId, userId);
    await this.redis.command(["SREM", userSocketsKey, socketId]);
    const socketCountRaw = await this.redis.command(["SCARD", userSocketsKey]);
    const socketCount = typeof socketCountRaw === "number" ? socketCountRaw : 0;
    if (socketCount === 0) {
      await this.redis.command(["DEL", userSocketsKey]);
      await this.redis.command(["SREM", roomOnlineUsersKey(roomId), String(userId)]);
    }
  }

  private makeEvent<TType extends RealtimeServerEventType>(
    type: TType,
    input: {
      auctionId?: number;
      roomId?: number;
      payload: RealtimePayloadByEvent[TType];
    }
  ): RealtimeServerEvent<TType> {
    this.serverSeq += 1;
    const event = {
      type,
      serverSeq: this.serverSeq,
      serverTime: new Date().toISOString(),
      payload: input.payload
    } as RealtimeServerEvent<TType>;
    if (input.auctionId !== undefined) {
      event.auctionId = input.auctionId;
    }
    if (input.roomId !== undefined) {
      event.roomId = input.roomId;
    }

    return event;
  }

  private emitToRoom(room: string, event: RealtimeServerEvent): void {
    this.io?.to(room).emit(event.type, event);
  }
}
