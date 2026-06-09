import type { DemoContextResponse } from "@live-auction/shared";
import type { DbPool } from "../db/pool.js";
import { findDemoRoom } from "../repositories/rooms-repository.js";
import { listDemoBidders } from "../repositories/users-repository.js";

export async function getDemoContext(pool: DbPool): Promise<DemoContextResponse> {
  const [room, bidders] = await Promise.all([findDemoRoom(pool), listDemoBidders(pool)]);

  return {
    room,
    bidders
  };
}
