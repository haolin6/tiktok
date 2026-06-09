import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { BidDto } from "@live-auction/shared";
import type { DbExecutor } from "../db/executor.js";
import { notFound } from "../errors.js";
import { mapBid } from "./row-mappers.js";

interface BidRow extends RowDataPacket {
  id: number;
  auction_id: number;
  user_id: number;
  amount: number;
  request_id: string;
  accepted: number | boolean;
  reject_reason: string | null;
  created_at: Date;
  user_nickname?: string | null;
  user_role?: "streamer" | "bidder" | null;
}

const bidColumns = `
  b.id,
  b.auction_id,
  b.user_id,
  b.amount,
  b.request_id,
  b.accepted,
  b.reject_reason,
  b.created_at,
  u.nickname AS user_nickname,
  u.role AS user_role
`;

export interface InsertBidInput {
  auctionId: number;
  userId: number;
  amount: number;
  requestId: string;
  accepted: boolean;
  rejectReason: string | null;
}

export async function insertBid(db: DbExecutor, input: InsertBidInput): Promise<BidDto> {
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO bids (auction_id, user_id, amount, request_id, accepted, reject_reason)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.auctionId,
      input.userId,
      input.amount,
      input.requestId,
      input.accepted,
      input.rejectReason
    ]
  );

  return findBidById(db, result.insertId);
}

export async function findBidById(db: DbExecutor, bidId: number): Promise<BidDto> {
  const [rows] = await db.execute<BidRow[]>(
    `SELECT ${bidColumns}
     FROM bids b
     INNER JOIN users u ON u.id = b.user_id
     WHERE b.id = ?
     LIMIT 1`,
    [bidId]
  );

  const row = rows[0];
  if (!row) {
    throw notFound(`Bid ${bidId} was not found.`);
  }

  return mapBid(row);
}

export async function findBidByRequest(
  db: DbExecutor,
  auctionId: number,
  userId: number,
  requestId: string
): Promise<BidDto | null> {
  const [rows] = await db.execute<BidRow[]>(
    `SELECT ${bidColumns}
     FROM bids b
     INNER JOIN users u ON u.id = b.user_id
     WHERE b.auction_id = ?
       AND b.user_id = ?
       AND b.request_id = ?
     LIMIT 1`,
    [auctionId, userId, requestId]
  );

  return rows[0] ? mapBid(rows[0]) : null;
}

export async function listRecentAcceptedBids(
  db: DbExecutor,
  auctionId: number,
  limit = 5
): Promise<BidDto[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 20);
  const [rows] = await db.execute<BidRow[]>(
    `SELECT ${bidColumns}
     FROM bids b
     INNER JOIN users u ON u.id = b.user_id
     WHERE b.auction_id = ?
       AND b.accepted = TRUE
     ORDER BY b.id DESC
     LIMIT ${safeLimit}`,
    [auctionId]
  );

  return rows.map(mapBid);
}

export async function listBidRanking(
  db: DbExecutor,
  auctionId: number,
  limit = 5
): Promise<BidDto[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 20);
  const [rows] = await db.execute<BidRow[]>(
    `SELECT ${bidColumns}
     FROM bids b
     INNER JOIN users u ON u.id = b.user_id
     INNER JOIN (
       SELECT user_id, MAX(amount) AS max_amount
       FROM bids
       WHERE auction_id = ?
         AND accepted = TRUE
       GROUP BY user_id
     ) ranked ON ranked.user_id = b.user_id AND ranked.max_amount = b.amount
     WHERE b.auction_id = ?
       AND b.accepted = TRUE
     ORDER BY b.amount DESC, b.created_at ASC, b.id ASC
     LIMIT ${safeLimit}`,
    [auctionId, auctionId]
  );

  return rows.map(mapBid);
}

export async function listBidsByUser(db: DbExecutor, userId: number): Promise<BidDto[]> {
  const [rows] = await db.execute<BidRow[]>(
    `SELECT ${bidColumns}
     FROM bids b
     INNER JOIN users u ON u.id = b.user_id
     WHERE b.user_id = ?
     ORDER BY b.created_at DESC, b.id DESC
     LIMIT 100`,
    [userId]
  );

  return rows.map(mapBid);
}
