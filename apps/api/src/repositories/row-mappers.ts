import type {
  AuctionDto,
  AuctionRoomDto,
  BidDto,
  OrderDto,
  ProductDto
} from "@live-auction/shared";
import type { UserDto } from "@live-auction/shared";

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    return Number(value);
  }

  throw new Error(`Expected numeric database value, received ${String(value)}`);
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : toNumber(value);
}

export function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }

  throw new Error(`Expected date database value, received ${String(value)}`);
}

interface ProductRow {
  id: unknown;
  title: string;
  image_url: string | null;
  description: string | null;
  created_by: unknown;
  created_at: unknown;
}

export function mapProduct(row: ProductRow): ProductDto {
  return {
    id: toNumber(row.id),
    title: row.title,
    imageUrl: row.image_url,
    description: row.description,
    createdBy: toNumber(row.created_by),
    createdAt: toIsoString(row.created_at)
  };
}

interface AuctionRoomRow {
  id: unknown;
  title: string;
  video_url: string | null;
  status: "active" | "inactive";
}

export function mapAuctionRoom(row: AuctionRoomRow): AuctionRoomDto {
  return {
    id: toNumber(row.id),
    title: row.title,
    videoUrl: row.video_url,
    status: row.status
  };
}

interface AuctionRow {
  id: unknown;
  room_id: unknown;
  product_id: unknown;
  start_price: unknown;
  increment_step: unknown;
  ceiling_price: unknown | null;
  start_at: unknown;
  end_at: unknown;
  extend_threshold_sec: unknown;
  extend_duration_sec: unknown;
  status: AuctionDto["status"];
  current_price: unknown;
  current_winner_id: unknown | null;
  version: unknown;
  created_by: unknown;
  created_at: unknown;
  updated_at: unknown;
}

export function mapAuction(row: AuctionRow): AuctionDto {
  return {
    id: toNumber(row.id),
    roomId: toNumber(row.room_id),
    productId: toNumber(row.product_id),
    startPrice: toNumber(row.start_price),
    incrementStep: toNumber(row.increment_step),
    ceilingPrice: toNullableNumber(row.ceiling_price),
    startAt: toIsoString(row.start_at),
    endAt: toIsoString(row.end_at),
    extendThresholdSec: toNumber(row.extend_threshold_sec),
    extendDurationSec: toNumber(row.extend_duration_sec),
    status: row.status,
    currentPrice: toNumber(row.current_price),
    currentWinnerId: toNullableNumber(row.current_winner_id),
    version: toNumber(row.version),
    createdBy: toNumber(row.created_by),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

interface UserRow {
  id: unknown;
  nickname: string;
  role: UserDto["role"];
}

export function mapUser(row: UserRow): UserDto {
  return {
    id: toNumber(row.id),
    nickname: row.nickname,
    role: row.role
  };
}

interface BidRow {
  id: unknown;
  auction_id: unknown;
  user_id: unknown;
  amount: unknown;
  request_id: string;
  accepted: unknown;
  reject_reason: string | null;
  created_at: unknown;
  user_nickname?: string | null;
  user_role?: UserDto["role"] | null;
}

export function mapBid(row: BidRow): BidDto {
  const bid: BidDto = {
    id: toNumber(row.id),
    auctionId: toNumber(row.auction_id),
    userId: toNumber(row.user_id),
    amount: toNumber(row.amount),
    requestId: row.request_id,
    accepted: Boolean(row.accepted),
    rejectReason: row.reject_reason,
    createdAt: toIsoString(row.created_at)
  };

  if (row.user_nickname && row.user_role) {
    bid.user = {
      id: bid.userId,
      nickname: row.user_nickname,
      role: row.user_role
    };
  }

  return bid;
}

interface OrderRow {
  id: unknown;
  auction_id: unknown;
  product_id: unknown;
  buyer_id: unknown;
  amount: unknown;
  status: OrderDto["status"];
  created_at: unknown;
  updated_at: unknown;
}

export function mapOrder(row: OrderRow): OrderDto {
  return {
    id: toNumber(row.id),
    auctionId: toNumber(row.auction_id),
    productId: toNumber(row.product_id),
    buyerId: toNumber(row.buyer_id),
    amount: toNumber(row.amount),
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}
