import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { OrderDto } from "@live-auction/shared";
import type { DbExecutor } from "../db/executor.js";
import { notFound } from "../errors.js";
import { mapOrder } from "./row-mappers.js";

interface OrderRow extends RowDataPacket {
  id: number;
  auction_id: number;
  product_id: number;
  buyer_id: number;
  amount: number;
  status: OrderDto["status"];
  created_at: Date;
  updated_at: Date;
}

const orderColumns = `
  id,
  auction_id,
  product_id,
  buyer_id,
  amount,
  status,
  created_at,
  updated_at
`;

export interface InsertOrderInput {
  auctionId: number;
  productId: number;
  buyerId: number;
  amount: number;
}

export async function insertOrderIfMissing(
  db: DbExecutor,
  input: InsertOrderInput
): Promise<OrderDto> {
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO orders (auction_id, product_id, buyer_id, amount)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [input.auctionId, input.productId, input.buyerId, input.amount]
  );

  return findOrderById(db, result.insertId);
}

export async function findOrderById(db: DbExecutor, orderId: number): Promise<OrderDto> {
  const [rows] = await db.execute<OrderRow[]>(
    `SELECT ${orderColumns} FROM orders WHERE id = ? LIMIT 1`,
    [orderId]
  );

  const row = rows[0];
  if (!row) {
    throw notFound(`Order ${orderId} was not found.`);
  }

  return mapOrder(row);
}

export async function findOrderByIdForUpdate(
  db: DbExecutor,
  orderId: number
): Promise<OrderDto> {
  const [rows] = await db.execute<OrderRow[]>(
    `SELECT ${orderColumns} FROM orders WHERE id = ? LIMIT 1 FOR UPDATE`,
    [orderId]
  );

  const row = rows[0];
  if (!row) {
    throw notFound(`Order ${orderId} was not found.`);
  }

  return mapOrder(row);
}

export async function findOrderByAuctionId(
  db: DbExecutor,
  auctionId: number
): Promise<OrderDto | null> {
  const [rows] = await db.execute<OrderRow[]>(
    `SELECT ${orderColumns} FROM orders WHERE auction_id = ? LIMIT 1`,
    [auctionId]
  );

  return rows[0] ? mapOrder(rows[0]) : null;
}

export async function listRecentOrders(db: DbExecutor): Promise<OrderDto[]> {
  const [rows] = await db.execute<OrderRow[]>(
    `SELECT ${orderColumns}
     FROM orders
     ORDER BY created_at DESC, id DESC
     LIMIT 100`
  );

  return rows.map(mapOrder);
}

export async function listOrdersByBuyer(db: DbExecutor, buyerId: number): Promise<OrderDto[]> {
  const [rows] = await db.execute<OrderRow[]>(
    `SELECT ${orderColumns}
     FROM orders
     WHERE buyer_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 100`,
    [buyerId]
  );

  return rows.map(mapOrder);
}

export async function updateOrderStatus(
  db: DbExecutor,
  orderId: number,
  status: OrderDto["status"]
): Promise<OrderDto> {
  await db.execute<ResultSetHeader>("UPDATE orders SET status = ? WHERE id = ?", [
    status,
    orderId
  ]);

  return findOrderById(db, orderId);
}
