import type {
  BidDto,
  OrderDetailResponse,
  OrderDto,
  OrderListResponse,
  OrderSummaryDto,
  UserBidListResponse,
  UserOrderListResponse
} from "@live-auction/shared";
import type { DbExecutor } from "../db/executor.js";
import type { DbPool } from "../db/pool.js";
import { conflict } from "../errors.js";
import { findAuctionById } from "../repositories/auctions-repository.js";
import { listBidsByUser } from "../repositories/bids-repository.js";
import { insertAuctionEvent } from "../repositories/events-repository.js";
import {
  findOrderById,
  findOrderByIdForUpdate,
  listOrdersByBuyer,
  listRecentOrders,
  updateOrderStatus
} from "../repositories/orders-repository.js";
import { findProductById } from "../repositories/products-repository.js";
import { findUserById } from "../repositories/users-repository.js";
import { settleDueRunningAuctions } from "./auctions-service.js";

async function toOrderSummary(db: DbExecutor, order: OrderDto): Promise<OrderSummaryDto> {
  const [auction, product, buyer] = await Promise.all([
    findAuctionById(db, order.auctionId),
    findProductById(db, order.productId),
    findUserById(db, order.buyerId)
  ]);

  return {
    ...order,
    auction,
    product,
    buyer
  };
}

export async function getOrderDetail(
  pool: DbPool,
  orderId: number
): Promise<OrderDetailResponse> {
  const order = await findOrderById(pool, orderId);
  return {
    order: await toOrderSummary(pool, order)
  };
}

export async function getOrderList(pool: DbPool): Promise<OrderListResponse> {
  await settleDueRunningAuctions(pool);
  const orders = await listRecentOrders(pool);

  return {
    items: await Promise.all(orders.map((order) => toOrderSummary(pool, order)))
  };
}

export async function getUserOrders(
  pool: DbPool,
  userId: number
): Promise<UserOrderListResponse> {
  await findUserById(pool, userId);
  await settleDueRunningAuctions(pool);
  const orders = await listOrdersByBuyer(pool, userId);

  return {
    items: await Promise.all(orders.map((order) => toOrderSummary(pool, order)))
  };
}

export async function getUserBids(pool: DbPool, userId: number): Promise<UserBidListResponse> {
  await findUserById(pool, userId);
  const bids: BidDto[] = await listBidsByUser(pool, userId);

  return {
    items: bids
  };
}

export async function mockPayOrder(pool: DbPool, orderId: number): Promise<OrderDetailResponse> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let order = await findOrderByIdForUpdate(connection, orderId);
    if (order.status === "canceled") {
      throw conflict(`Order ${orderId} is canceled and cannot be paid.`);
    }

    if (order.status === "pending_payment") {
      order = await updateOrderStatus(connection, orderId, "paid");
      const auction = await findAuctionById(connection, order.auctionId);
      await insertAuctionEvent(connection, {
        auctionId: order.auctionId,
        eventType: "order.paid",
        payload: {
          auctionId: order.auctionId,
          roomId: auction.roomId,
          orderId: order.id,
          buyerId: order.buyerId,
          amount: order.amount,
          status: order.status,
          paidAt: order.updatedAt
        }
      });
    }

    await connection.commit();
    return {
      order: await toOrderSummary(pool, order)
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
