import type { RowDataPacket } from "mysql2";
import type { UserDto } from "@live-auction/shared";
import type { DbExecutor } from "../db/executor.js";
import { notFound } from "../errors.js";
import { mapUser } from "./row-mappers.js";

interface UserIdRow extends RowDataPacket {
  id: number;
}

interface UserRow extends RowDataPacket {
  id: number;
  nickname: string;
  role: UserDto["role"];
}

export async function findDefaultStreamerId(db: DbExecutor): Promise<number> {
  const [rows] = await db.execute<UserIdRow[]>(
    "SELECT id FROM users WHERE demo_key = ? AND role = 'streamer' LIMIT 1",
    ["demo_streamer"]
  );

  const row = rows[0];
  if (!row) {
    throw notFound("Default streamer seed user is missing. Run npm run db:seed.");
  }

  return Number(row.id);
}

export async function userExists(db: DbExecutor, userId: number): Promise<boolean> {
  const [rows] = await db.execute<UserIdRow[]>("SELECT id FROM users WHERE id = ? LIMIT 1", [
    userId
  ]);

  return rows.length > 0;
}

export async function findUserById(db: DbExecutor, userId: number): Promise<UserDto> {
  const [rows] = await db.execute<UserRow[]>(
    "SELECT id, nickname, role FROM users WHERE id = ? LIMIT 1",
    [userId]
  );

  const row = rows[0];
  if (!row) {
    throw notFound(`User ${userId} was not found.`);
  }

  return mapUser(row);
}

export async function listDemoBidders(db: DbExecutor): Promise<UserDto[]> {
  const [rows] = await db.execute<UserRow[]>(
    `SELECT id, nickname, role
     FROM users
     WHERE role = 'bidder'
       AND demo_key IN ('demo_user_1', 'demo_user_2', 'demo_user_3')
     ORDER BY demo_key`
  );

  return rows.map(mapUser);
}
