import type { AuctionStatus } from "./auction-status.js";

export type UserRole = "streamer" | "bidder";

export interface UserDto {
  id: number;
  nickname: string;
  role: UserRole;
}

export interface ProductDto {
  id: number;
  title: string;
  imageUrl: string | null;
  description: string | null;
  createdBy: number;
  createdAt: string;
}

export interface AuctionRoomDto {
  id: number;
  title: string;
  videoUrl: string | null;
  status: "active" | "inactive";
}

export interface AuctionDto {
  id: number;
  roomId: number;
  productId: number;
  startPrice: number;
  incrementStep: number;
  ceilingPrice: number | null;
  startAt: string;
  endAt: string;
  extendThresholdSec: number;
  extendDurationSec: number;
  status: AuctionStatus;
  currentPrice: number;
  currentWinnerId: number | null;
  version: number;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface BidDto {
  id: number;
  auctionId: number;
  userId: number;
  amount: number;
  requestId: string;
  accepted: boolean;
  rejectReason: string | null;
  createdAt: string;
  user?: UserDto;
}

export type OrderStatus = "pending_payment" | "paid" | "canceled";

export interface OrderDto {
  id: number;
  auctionId: number;
  productId: number;
  buyerId: number;
  amount: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OrderSummaryDto extends OrderDto {
  auction: AuctionDto;
  product: ProductDto;
  buyer: UserDto;
}

export interface CreateProductRequest {
  title: string;
  imageUrl?: string | null;
  description?: string | null;
  createdBy?: number;
}

export interface CreateProductResponse {
  product: ProductDto;
}

export interface CreateAuctionRequest {
  roomId: number;
  productId: number;
  startPrice: number;
  incrementStep: number;
  ceilingPrice?: number | null;
  startAt: string;
  endAt: string;
  extendThresholdSec?: number;
  extendDurationSec?: number;
  createdBy?: number;
}

export interface CreateAuctionResponse {
  auction: AuctionDto;
}

export interface UpdateAuctionRequest {
  startPrice?: number;
  incrementStep?: number;
  ceilingPrice?: number | null;
  startAt?: string;
  endAt?: string;
  extendThresholdSec?: number;
  extendDurationSec?: number;
}

export interface UpdateAuctionResponse {
  auction: AuctionDto;
}

export interface AuctionListResponse {
  items: AuctionDto[];
}

export interface AuctionDetailResponse {
  auction: AuctionDto;
}

export interface AuctionSnapshotResponse {
  auction: AuctionDto;
  product: ProductDto;
  room: AuctionRoomDto;
  currentPrice: number;
  nextBidAmount: number | null;
  currentWinner: UserDto | null;
  recentBids: BidDto[];
  order: OrderDto | null;
  serverTime: string;
}

export interface CancelAuctionRequest {
  reason: string;
}

export interface CancelAuctionResponse {
  auction: AuctionDto;
}

export interface StartAuctionResponse {
  auction: AuctionDto;
}

export interface PlaceBidRequest {
  userId: number;
  amount: number;
  requestId: string;
}

export interface AuctionExtensionDto {
  auctionId: number;
  previousEndAt: string;
  newEndAt: string;
  extendDurationSec: number;
  triggerBidId: number;
}

export interface PlaceBidResponse {
  bid: BidDto;
  auction: AuctionDto;
  snapshot: AuctionSnapshotResponse;
  extension: AuctionExtensionDto | null;
  previousWinnerId: number | null;
  idempotentReplay?: boolean;
}

export interface OrderListResponse {
  items: OrderSummaryDto[];
}

export interface UserOrderListResponse {
  items: OrderSummaryDto[];
}

export interface UserBidListResponse {
  items: BidDto[];
}

export interface MockPayOrderResponse {
  order: OrderSummaryDto;
}

export interface OrderDetailResponse {
  order: OrderSummaryDto;
}

export interface DemoContextResponse {
  room: AuctionRoomDto;
  bidders: UserDto[];
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
