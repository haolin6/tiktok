export const AUCTION_STATUSES = [
  "Draft",
  "Scheduled",
  "Running",
  "Sold",
  "Passed",
  "Canceled"
] as const;

export type AuctionStatus = (typeof AUCTION_STATUSES)[number];

export const TERMINAL_AUCTION_STATUSES: readonly AuctionStatus[] = [
  "Sold",
  "Passed",
  "Canceled"
];

export const AUCTION_STATUS_TRANSITIONS: Record<AuctionStatus, readonly AuctionStatus[]> = {
  Draft: ["Scheduled", "Canceled"],
  Scheduled: ["Running", "Canceled"],
  Running: ["Sold", "Passed", "Canceled"],
  Sold: [],
  Passed: [],
  Canceled: []
};

export function isAuctionStatus(value: string): value is AuctionStatus {
  return AUCTION_STATUSES.includes(value as AuctionStatus);
}

export function canTransitionAuctionStatus(from: AuctionStatus, to: AuctionStatus): boolean {
  return AUCTION_STATUS_TRANSITIONS[from].includes(to);
}

export function assertAuctionStatusTransition(from: AuctionStatus, to: AuctionStatus): void {
  if (!canTransitionAuctionStatus(from, to)) {
    throw new Error(`Invalid auction status transition: ${from} -> ${to}`);
  }
}

export function isTerminalAuctionStatus(status: AuctionStatus): boolean {
  return TERMINAL_AUCTION_STATUSES.includes(status);
}
