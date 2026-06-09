import type { ResultSetHeader } from "mysql2";
import type { DbExecutor } from "../db/executor.js";

export interface InsertAuctionEventInput {
  auctionId: number | null;
  eventType: string;
  payload: Record<string, unknown>;
}

export async function insertAuctionEvent(
  db: DbExecutor,
  input: InsertAuctionEventInput
): Promise<number> {
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO auction_events (auction_id, event_type, payload_json)
     VALUES (?, ?, CAST(? AS JSON))`,
    [input.auctionId, input.eventType, JSON.stringify(input.payload)]
  );

  return result.insertId;
}
