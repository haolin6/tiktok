import { describe, expect, it } from "vitest";
import {
  assertAuctionStatusTransition,
  canTransitionAuctionStatus,
  isTerminalAuctionStatus
} from "./auction-status.js";

describe("auction status machine", () => {
  it("allows node 1 legal status transitions", () => {
    expect(canTransitionAuctionStatus("Draft", "Scheduled")).toBe(true);
    expect(canTransitionAuctionStatus("Draft", "Canceled")).toBe(true);
    expect(canTransitionAuctionStatus("Scheduled", "Running")).toBe(true);
    expect(canTransitionAuctionStatus("Scheduled", "Canceled")).toBe(true);
    expect(canTransitionAuctionStatus("Running", "Sold")).toBe(true);
    expect(canTransitionAuctionStatus("Running", "Passed")).toBe(true);
    expect(canTransitionAuctionStatus("Running", "Canceled")).toBe(true);
  });

  it("rejects illegal status transitions", () => {
    expect(canTransitionAuctionStatus("Draft", "Sold")).toBe(false);
    expect(canTransitionAuctionStatus("Scheduled", "Sold")).toBe(false);
    expect(canTransitionAuctionStatus("Canceled", "Running")).toBe(false);
    expect(() => assertAuctionStatusTransition("Passed", "Canceled")).toThrow(
      "Invalid auction status transition"
    );
  });

  it("keeps terminal states closed", () => {
    for (const status of ["Sold", "Passed", "Canceled"] as const) {
      expect(isTerminalAuctionStatus(status)).toBe(true);
      expect(canTransitionAuctionStatus(status, "Canceled")).toBe(false);
      expect(canTransitionAuctionStatus(status, "Running")).toBe(false);
    }
  });
});
