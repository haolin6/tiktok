import type {
  AuctionExtensionDto,
  AuctionSnapshotResponse,
  BidDto,
  OrderStatus
} from "./api-types.js";
import type { AuctionStatus } from "./auction-status.js";

export type RealtimeClientEventType =
  | "room.join"
  | "room.leave"
  | "auction.subscribe"
  | "bid.place";

export interface RoomJoinPayload {
  roomId: number;
  userId: number;
}

export interface RoomLeavePayload {
  roomId: number;
}

export interface AuctionSubscribePayload {
  auctionId: number;
}

export interface BidPlacePayload {
  auctionId: number;
  amount: number;
  requestId: string;
  userId?: number;
}

export interface RealtimeClientMessage<
  TType extends RealtimeClientEventType = RealtimeClientEventType,
  TPayload = unknown
> {
  event: TType;
  requestId?: string;
  payload: TPayload;
}

export type RealtimeServerEventType =
  | "auction.snapshot"
  | "bid.accepted"
  | "bid.rejected"
  | "ranking.updated"
  | "auction.extended"
  | "auction.sold"
  | "auction.passed"
  | "auction.canceled"
  | "order.paid"
  | "user.outbid"
  | "room.presence";

export interface BidAcceptedPayload {
  auctionId: number;
  bidId: number;
  userId: number;
  amount: number;
  requestId: string;
}

export interface BidRejectedPayload {
  auctionId: number;
  userId: number;
  amount: number;
  requestId: string;
  reason: string;
}

export interface RankingUpdatedPayload {
  auctionId: number;
  recentBids: BidDto[];
  ranking: BidDto[];
}

export interface AuctionSoldPayload {
  auctionId: number;
  orderId: number;
  buyerId: number;
  amount: number;
  reason: "ceiling" | "ended";
}

export interface AuctionPassedPayload {
  auctionId: number;
  reason: "ended";
}

export interface AuctionCanceledPayload {
  auctionId: number;
  previousStatus: AuctionStatus;
  status: "Canceled";
  reason: string;
}

export interface OrderPaidPayload {
  auctionId: number;
  roomId: number;
  orderId: number;
  buyerId: number;
  amount: number;
  status: Extract<OrderStatus, "paid">;
  paidAt: string;
}

export interface UserOutbidPayload {
  auctionId: number;
  previousWinnerId: number;
  newWinnerId: number;
  amount: number;
}

export interface RoomPresencePayload {
  roomId: number;
  onlineCount: number;
}

export type RealtimePayloadByEvent = {
  "auction.snapshot": AuctionSnapshotResponse;
  "bid.accepted": BidAcceptedPayload;
  "bid.rejected": BidRejectedPayload;
  "ranking.updated": RankingUpdatedPayload;
  "auction.extended": AuctionExtensionDto;
  "auction.sold": AuctionSoldPayload;
  "auction.passed": AuctionPassedPayload;
  "auction.canceled": AuctionCanceledPayload;
  "order.paid": OrderPaidPayload;
  "user.outbid": UserOutbidPayload;
  "room.presence": RoomPresencePayload;
};

export interface RealtimeServerEvent<
  TType extends RealtimeServerEventType = RealtimeServerEventType
> {
  type: TType;
  auctionId?: number;
  roomId?: number;
  serverSeq: number;
  serverTime: string;
  payload: RealtimePayloadByEvent[TType];
}

export type AnyRealtimeServerEvent = {
  [TType in RealtimeServerEventType]: RealtimeServerEvent<TType>;
}[RealtimeServerEventType];

export interface RealtimeAck<TPayload = unknown> {
  ok: boolean;
  payload?: TPayload;
  error?: {
    code: string;
    message: string;
  };
}
