import type { RowDataPacket } from "mysql2";
import { io, type Socket } from "socket.io-client";
import type { RealtimeAck } from "@live-auction/shared";
import type { DbPool } from "../db/pool.js";

interface IdRow extends RowDataPacket {
  id: number;
}

interface CountRow extends RowDataPacket {
  count: number;
}

type RealtimePredicate = (packet: any) => boolean;

export async function openSocket(url: string): Promise<Socket> {
  const socket = io(url, {
    transports: ["websocket"]
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WebSocket open timed out.")), 2_000);
    socket.on("connect", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.on("connect_error", () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket failed to open."));
    });
  });

  return socket;
}

export async function sendRealtime(
  socket: Socket,
  event: string,
  payload: unknown
): Promise<RealtimeAck> {
  return new Promise<RealtimeAck>((resolve) => {
    socket.emit(event, payload, (ack: RealtimeAck) => {
      resolve(ack);
    });
  });
}

export async function waitForRealtimeEvent(
  socket: Socket,
  eventName: string,
  predicate: RealtimePredicate = () => true,
  timeoutMs = 3_000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, onMessage);
      reject(new Error(`Timed out waiting for ${eventName}.`));
    }, timeoutMs);

    function onMessage(event: unknown) {
      const packet = { event: eventName, data: event };
      if (predicate(packet)) {
        clearTimeout(timeout);
        socket.off(eventName, onMessage);
        resolve(packet);
      }
    }

    socket.on(eventName, onMessage);
  });
}

export async function expectNoRealtimeEvent(
  socket: Socket,
  eventName: string,
  predicate: RealtimePredicate = () => true,
  timeoutMs = 400
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, onMessage);
      resolve();
    }, timeoutMs);

    function onMessage(event: unknown) {
      const packet = { event: eventName, data: event };
      if (predicate(packet)) {
        clearTimeout(timeout);
        socket.off(eventName, onMessage);
        reject(new Error(`Unexpected ${eventName} event.`));
      }
    }

    socket.on(eventName, onMessage);
  });
}

export async function joinAndSubscribe(
  socket: Socket,
  roomId: number,
  userId: number,
  auctionId: number
): Promise<void> {
  const snapshot = waitForRealtimeEvent(socket, "auction.snapshot", (packet) => {
    return packet.data.payload.auction.id === auctionId;
  });
  const joinAck = await sendRealtime(socket, "room.join", { roomId, userId });
  if (!joinAck.ok) {
    throw new Error(joinAck.error?.message ?? "room.join failed.");
  }
  const subscribeAck = await sendRealtime(socket, "auction.subscribe", { auctionId });
  if (!subscribeAck.ok) {
    throw new Error(subscribeAck.error?.message ?? "auction.subscribe failed.");
  }
  await snapshot;
}

export async function createSecondRoom(pool: DbPool, suffix: string): Promise<number> {
  const [streamerRows] = await pool.execute<IdRow[]>(
    "SELECT id FROM users WHERE demo_key = 'demo_streamer' LIMIT 1"
  );
  const streamerId = Number(streamerRows[0]?.id ?? 0);
  if (!streamerId) {
    throw new Error("Demo streamer is missing. Run npm run db:seed.");
  }

  await pool.execute(
    `INSERT INTO auction_rooms (demo_key, title, video_url, status, created_by)
     VALUES (?, ?, ?, 'active', ?)`,
    [`test_room_${suffix}`, `测试直播间 ${suffix}`, "/demo/live-room.mp4", streamerId]
  );

  const [roomRows] = await pool.execute<IdRow[]>(
    "SELECT id FROM auction_rooms WHERE demo_key = ? LIMIT 1",
    [`test_room_${suffix}`]
  );
  const roomId = Number(roomRows[0]?.id ?? 0);
  if (!roomId) {
    throw new Error("Failed to create second test room.");
  }

  return roomId;
}

export async function countBids(
  pool: DbPool,
  auctionId: number,
  filters: { accepted?: boolean; requestId?: string; rejectReason?: string } = {}
): Promise<number> {
  const clauses = ["auction_id = ?"];
  const params: Array<string | number | boolean> = [auctionId];
  if (filters.accepted !== undefined) {
    clauses.push("accepted = ?");
    params.push(filters.accepted);
  }
  if (filters.requestId !== undefined) {
    clauses.push("request_id = ?");
    params.push(filters.requestId);
  }
  if (filters.rejectReason !== undefined) {
    clauses.push("reject_reason = ?");
    params.push(filters.rejectReason);
  }

  const [rows] = await pool.execute<CountRow[]>(
    `SELECT COUNT(*) AS count FROM bids WHERE ${clauses.join(" AND ")}`,
    params
  );
  return Number(rows[0]?.count ?? 0);
}

export async function countEvents(
  pool: DbPool,
  auctionId: number,
  eventType: string
): Promise<number> {
  const [rows] = await pool.execute<CountRow[]>(
    "SELECT COUNT(*) AS count FROM auction_events WHERE auction_id = ? AND event_type = ?",
    [auctionId, eventType]
  );
  return Number(rows[0]?.count ?? 0);
}
