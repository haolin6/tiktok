import type { FastifyInstance } from "fastify";
import type {
  MockPayOrderResponse,
  OrderDetailResponse,
  OrderListResponse,
  UserBidListResponse,
  UserOrderListResponse
} from "@live-auction/shared";
import type { DbPool } from "../db/pool.js";
import type { RealtimeHub } from "../realtime/realtime-hub.js";
import {
  getOrderDetail,
  getOrderList,
  getUserBids,
  getUserOrders,
  mockPayOrder
} from "../services/orders-service.js";
import { parseNumericId } from "./route-helpers.js";

interface OrderIdParams {
  id: string;
}

interface UserIdQuery {
  userId?: string;
}

function parseUserId(query: UserIdQuery): number {
  return parseNumericId(query.userId ?? "", "user id");
}

export async function registerOrderRoutes(
  app: FastifyInstance,
  pool: DbPool,
  realtimeHub: RealtimeHub
): Promise<void> {
  app.get<{ Reply: OrderListResponse }>("/api/orders", async () => {
    return getOrderList(pool);
  });

  app.get<{ Params: OrderIdParams; Reply: OrderDetailResponse }>(
    "/api/orders/:id",
    async (request) => {
      return getOrderDetail(pool, parseNumericId(request.params.id, "order id"));
    }
  );

  app.post<{ Params: OrderIdParams; Reply: MockPayOrderResponse }>(
    "/api/orders/:id/mock-pay",
    async (request) => {
      const response = await mockPayOrder(pool, parseNumericId(request.params.id, "order id"));
      await realtimeHub.publishOrderPaid(response.order);
      return response;
    }
  );

  app.get<{ Querystring: UserIdQuery; Reply: UserOrderListResponse }>(
    "/api/me/orders",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["userId"],
          additionalProperties: false,
          properties: {
            userId: { type: "string", minLength: 1 }
          }
        }
      }
    },
    async (request) => {
      return getUserOrders(pool, parseUserId(request.query));
    }
  );

  app.get<{ Querystring: UserIdQuery; Reply: UserBidListResponse }>(
    "/api/me/bids",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["userId"],
          additionalProperties: false,
          properties: {
            userId: { type: "string", minLength: 1 }
          }
        }
      }
    },
    async (request) => {
      return getUserBids(pool, parseUserId(request.query));
    }
  );
}
