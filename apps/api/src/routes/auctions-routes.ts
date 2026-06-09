import type { FastifyInstance } from "fastify";
import type {
  AuctionDetailResponse,
  AuctionListResponse,
  AuctionSnapshotResponse,
  CancelAuctionRequest,
  CancelAuctionResponse,
  CreateAuctionRequest,
  CreateAuctionResponse,
  PlaceBidRequest,
  PlaceBidResponse,
  StartAuctionResponse
} from "@live-auction/shared";
import type { DbPool } from "../db/pool.js";
import type { RealtimeHub } from "../realtime/realtime-hub.js";
import {
  cancelAuction,
  createAuction,
  getAuctionDetail,
  getAuctionList,
  getAuctionSnapshotWithSettlementSignal,
  placeBid,
  startAuction
} from "../services/auctions-service.js";
import type { BidCoordinator } from "../services/bid-coordinator.js";
import { parseNumericId } from "./route-helpers.js";

interface AuctionIdParams {
  id: string;
}

export async function registerAuctionRoutes(
  app: FastifyInstance,
  pool: DbPool,
  realtimeHub: RealtimeHub,
  bidCoordinator: BidCoordinator
): Promise<void> {
  app.post<{ Body: CreateAuctionRequest; Reply: CreateAuctionResponse }>(
    "/api/auctions",
    {
      schema: {
        body: {
          type: "object",
          required: ["roomId", "productId", "startPrice", "incrementStep", "startAt", "endAt"],
          additionalProperties: false,
          properties: {
            roomId: { type: "integer", minimum: 1 },
            productId: { type: "integer", minimum: 1 },
            startPrice: { type: "number", minimum: 0 },
            incrementStep: { type: "number", exclusiveMinimum: 0 },
            ceilingPrice: { type: ["number", "null"], minimum: 0 },
            startAt: { type: "string", format: "date-time" },
            endAt: { type: "string", format: "date-time" },
            extendThresholdSec: { type: "integer", minimum: 1 },
            extendDurationSec: { type: "integer", minimum: 1 },
            createdBy: { type: "integer", minimum: 1 }
          }
        }
      }
    },
    async (request) => {
      const auction = await createAuction(pool, request.body);
      return { auction };
    }
  );

  app.get<{ Reply: AuctionListResponse }>("/api/auctions", async () => {
    return getAuctionList(pool);
  });

  app.get<{ Params: AuctionIdParams; Reply: AuctionDetailResponse }>(
    "/api/auctions/:id",
    async (request) => {
      return getAuctionDetail(pool, parseNumericId(request.params.id, "auction id"));
    }
  );

  app.get<{ Params: AuctionIdParams; Reply: AuctionSnapshotResponse }>(
    "/api/auctions/:id/snapshot",
    async (request) => {
      const { snapshot, settledBySnapshot } = await getAuctionSnapshotWithSettlementSignal(
        pool,
        parseNumericId(request.params.id, "auction id")
      );
      if (settledBySnapshot) {
        await realtimeHub.publishAuctionSettled(snapshot, "ended");
      }
      return snapshot;
    }
  );

  app.post<{
    Params: AuctionIdParams;
    Body: CancelAuctionRequest;
    Reply: CancelAuctionResponse;
  }>(
    "/api/auctions/:id/cancel",
    {
      schema: {
        body: {
          type: "object",
          required: ["reason"],
          additionalProperties: false,
          properties: {
            reason: { type: "string", minLength: 1, maxLength: 255 }
          }
        }
      }
    },
    async (request) => {
      const auction = await cancelAuction(
        pool,
        parseNumericId(request.params.id, "auction id"),
        request.body
      );
      await realtimeHub.publishAuctionCanceled(auction, request.body.reason);
      return { auction };
    }
  );

  app.post<{ Params: AuctionIdParams; Reply: StartAuctionResponse }>(
    "/api/auctions/:id/start",
    async (request) => {
      const auction = await startAuction(pool, parseNumericId(request.params.id, "auction id"));
      await realtimeHub.publishAuctionSnapshot(auction.id);
      return { auction };
    }
  );

  app.post<{
    Params: AuctionIdParams;
    Body: PlaceBidRequest;
    Reply: PlaceBidResponse;
  }>(
    "/api/auctions/:id/bids",
    {
      schema: {
        body: {
          type: "object",
          required: ["userId", "amount", "requestId"],
          additionalProperties: false,
          properties: {
            userId: { type: "integer", minimum: 1 },
            amount: { type: "number", exclusiveMinimum: 0 },
            requestId: { type: "string", minLength: 1, maxLength: 96 }
          }
        }
      }
    },
    async (request) => {
      const response = await placeBid(
        pool,
        parseNumericId(request.params.id, "auction id"),
        request.body,
        { bidCoordinator }
      );
      if (!response.idempotentReplay) {
        await realtimeHub.publishBidAccepted(response);
      }
      return response;
    }
  );
}
