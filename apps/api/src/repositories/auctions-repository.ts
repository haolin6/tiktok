import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { AuctionDto } from "@live-auction/shared";
import type { DbExecutor } from "../db/executor.js";
import { conflict, notFound } from "../errors.js";
import { mapAuction } from "./row-mappers.js";

interface AuctionRow extends RowDataPacket {
  id: number;
  room_id: number;
  product_id: number;
  start_price: number;
  increment_step: number;
  ceiling_price: number | null;
  start_at: Date;
  end_at: Date;
  extend_threshold_sec: number;
  extend_duration_sec: number;
  status: AuctionDto["status"];
  current_price: number;
  current_winner_id: number | null;
  version: number;
  created_by: number;
  created_at: Date;
  updated_at: Date;
}

const auctionColumns = `
  id,
  room_id,
  product_id,
  start_price,
  increment_step,
  ceiling_price,
  start_at,
  end_at,
  extend_threshold_sec,
  extend_duration_sec,
  status,
  current_price,
  current_winner_id,
  version,
  created_by,
  created_at,
  updated_at
`;

export interface InsertAuctionInput {
  roomId: number;
  productId: number;
  startPrice: number;
  incrementStep: number;
  ceilingPrice: number | null;
  startAt: Date;
  endAt: Date;
  extendThresholdSec: number;
  extendDurationSec: number;
  createdBy: number;
}

export async function insertAuction(
  db: DbExecutor,
  input: InsertAuctionInput
): Promise<AuctionDto> {
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO auctions (
       room_id,
       product_id,
       start_price,
       increment_step,
       ceiling_price,
       start_at,
       end_at,
       extend_threshold_sec,
       extend_duration_sec,
       status,
       current_price,
       created_by
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Scheduled', ?, ?)`,
    [
      input.roomId,
      input.productId,
      input.startPrice,
      input.incrementStep,
      input.ceilingPrice,
      input.startAt,
      input.endAt,
      input.extendThresholdSec,
      input.extendDurationSec,
      input.startPrice,
      input.createdBy
    ]
  );

  return findAuctionById(db, result.insertId);
}

export async function findAuctionById(db: DbExecutor, auctionId: number): Promise<AuctionDto> {
  const [rows] = await db.execute<AuctionRow[]>(
    `SELECT ${auctionColumns} FROM auctions WHERE id = ? LIMIT 1`,
    [auctionId]
  );

  const row = rows[0];
  if (!row) {
    throw notFound(`Auction ${auctionId} was not found.`);
  }

  return mapAuction(row);
}

export async function findAuctionByIdForUpdate(
  db: DbExecutor,
  auctionId: number
): Promise<AuctionDto> {
  const [rows] = await db.execute<AuctionRow[]>(
    `SELECT ${auctionColumns} FROM auctions WHERE id = ? LIMIT 1 FOR UPDATE`,
    [auctionId]
  );

  const row = rows[0];
  if (!row) {
    throw notFound(`Auction ${auctionId} was not found.`);
  }

  return mapAuction(row);
}

export async function listAuctions(db: DbExecutor): Promise<AuctionDto[]> {
  const [rows] = await db.execute<AuctionRow[]>(
    `SELECT ${auctionColumns} FROM auctions ORDER BY created_at DESC, id DESC LIMIT 100`
  );

  return rows.map(mapAuction);
}

export async function listDueRunningAuctions(db: DbExecutor, now: Date): Promise<AuctionDto[]> {
  const [rows] = await db.execute<AuctionRow[]>(
    `SELECT ${auctionColumns}
     FROM auctions
     WHERE status = 'Running'
       AND end_at <= ?
     ORDER BY end_at ASC, id ASC
     LIMIT 50`,
    [now]
  );

  return rows.map(mapAuction);
}

export async function updateAuctionStatus(
  db: DbExecutor,
  auctionId: number,
  fromStatus: AuctionDto["status"],
  toStatus: AuctionDto["status"]
): Promise<AuctionDto> {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE auctions
     SET status = ?, version = version + 1
     WHERE id = ? AND status = ?`,
    [toStatus, auctionId, fromStatus]
  );

  if (result.affectedRows !== 1) {
    throw conflict("Auction status changed while processing the request.");
  }

  return findAuctionById(db, auctionId);
}

export async function updateAuctionCurrentBid(
  db: DbExecutor,
  auctionId: number,
  amount: number,
  winnerId: number
): Promise<AuctionDto> {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE auctions
     SET current_price = ?,
         current_winner_id = ?,
         version = version + 1
     WHERE id = ?`,
    [amount, winnerId, auctionId]
  );

  if (result.affectedRows !== 1) {
    throw conflict("Auction changed while processing the bid.");
  }

  return findAuctionById(db, auctionId);
}

export async function updateAuctionEndAt(
  db: DbExecutor,
  auctionId: number,
  endAt: Date
): Promise<AuctionDto> {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE auctions
     SET end_at = ?,
         version = version + 1
     WHERE id = ?`,
    [endAt, auctionId]
  );

  if (result.affectedRows !== 1) {
    throw conflict("Auction changed while extending the end time.");
  }

  return findAuctionById(db, auctionId);
}
