import { describe, expect, it } from "vitest";
import type {
  BidDto,
  BidPlacePayload,
  OrderPaidPayload,
  RankingUpdatedPayload,
  RealtimeClientMessage
} from "./index.js";

describe("realtime event contracts", () => {
  it("allows bid.place without a client supplied userId", () => {
    const message = {
      event: "bid.place",
      payload: {
        auctionId: 1,
        amount: 109,
        requestId: "request-1"
      }
    } satisfies RealtimeClientMessage<"bid.place", BidPlacePayload>;

    expect(message.payload).not.toHaveProperty("userId");
  });

  it("keeps order.paid and ranking.updated payloads explicit", () => {
    const orderPaid = {
      auctionId: 1,
      roomId: 1,
      orderId: 2,
      buyerId: 3,
      amount: 109,
      status: "paid",
      paidAt: new Date(0).toISOString()
    } satisfies OrderPaidPayload;
    const bid = {
      id: 1,
      auctionId: 1,
      userId: 3,
      amount: 109,
      requestId: "request-1",
      accepted: true,
      rejectReason: null,
      createdAt: new Date(0).toISOString()
    } satisfies BidDto;
    const ranking = {
      auctionId: 1,
      recentBids: [bid],
      ranking: [bid]
    } satisfies RankingUpdatedPayload;

    expect(orderPaid.status).toBe("paid");
    expect(ranking.recentBids).toHaveLength(1);
    expect(ranking.ranking).toHaveLength(1);
  });
});
