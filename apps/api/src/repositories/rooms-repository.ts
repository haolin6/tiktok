import type { RowDataPacket } from "mysql2";
import type { AuctionRoomDto } from "@live-auction/shared";
import type { DbExecutor } from "../db/executor.js";
import { notFound } from "../errors.js";
import { mapAuctionRoom } from "./row-mappers.js";

interface RoomRow extends RowDataPacket {
  id: number;
  title: string;
  video_url: string | null;
  status: "active" | "inactive";
}

export async function findRoomById(db: DbExecutor, roomId: number): Promise<AuctionRoomDto> {
  const [rows] = await db.execute<RoomRow[]>(
    "SELECT id, title, video_url, status FROM auction_rooms WHERE id = ? LIMIT 1",
    [roomId]
  );

  const row = rows[0];
  if (!row) {
    throw notFound(`Auction room ${roomId} was not found.`);
  }

  return mapAuctionRoom(row);
}

export async function findDemoRoom(db: DbExecutor): Promise<AuctionRoomDto> {
  const [rows] = await db.execute<RoomRow[]>(
    "SELECT id, title, video_url, status FROM auction_rooms WHERE demo_key = ? LIMIT 1",
    ["demo_room_main"]
  );

  const row = rows[0];
  if (!row) {
    throw notFound("Demo auction room is missing. Run npm run db:seed.");
  }

  return mapAuctionRoom(row);
}
