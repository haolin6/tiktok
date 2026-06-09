# Concurrency Demo

## Goal

`npm run demo:concurrency` proves that 100 users submitting the same next bid at the same time do not raise the price more than once and do not create duplicate orders.

The script creates its own product, auction, and 100 prefixed bidders. It does not truncate tables.

## Command

```bash
npm run demo:concurrency
```

Verified on 2026-06-07 after switching to the official `redis` client:

```text
redis=PONG
auctionId=73
attempts=100
accepted=1
rejected=99
lockBusy=61
businessRejected=38
duplicate=0
durationMs=248
finalStatus=Sold
finalPrice=109
finalWinnerId=47
orderCount=1
acceptedBidRows=1
rejectedBidRows=99
lockBusyBidRows=61
rejectedEventRows=99
eventCounts=auction.created:1,auction.sold:1,auction.started:1,bid.accepted:1,bid.rejected:99,order.created:1
```

## Consistency Rules

- `attempts = accepted + rejected + duplicate`
- `rejected = lockBusy + businessRejected`
- `acceptedBidRows = accepted`
- `rejectedBidRows = rejected`
- `lockBusyBidRows = lockBusy`
- `orderCount = 1`

## Redis Keys

Bid request idempotency:

```text
auction:{auctionId}:user:{userId}:request:{requestId}
```

Values:

- `processing`
- `accepted:{bidId}`
- `rejected:{bidId}:{reason}`

Auction lock:

```text
auction:{auctionId}:lock
```

The lock uses `SET key token NX PX ttlMs` and Lua token verification before delete.

## MySQL Evidence Queries

```sql
SELECT
  a.id,
  a.status,
  a.current_price,
  a.current_winner_id,
  COUNT(DISTINCT o.id) AS order_count,
  SUM(CASE WHEN b.accepted THEN 1 ELSE 0 END) AS accepted_bids,
  SUM(CASE WHEN NOT b.accepted THEN 1 ELSE 0 END) AS rejected_bids,
  SUM(CASE WHEN b.reject_reason = 'lock_busy' THEN 1 ELSE 0 END) AS lock_busy_bids
FROM auctions a
LEFT JOIN orders o ON o.auction_id = a.id
LEFT JOIN bids b ON b.auction_id = a.id
WHERE a.id = 73
GROUP BY a.id, a.status, a.current_price, a.current_winner_id;
```

Verified result:

```text
id  status  current_price  current_winner_id  order_count  accepted_bids  rejected_bids  lock_busy_bids
73  Sold    109.00         47                 1            1              99             61
```

```sql
SELECT event_type, COUNT(*) AS event_count
FROM auction_events
WHERE auction_id = 73
GROUP BY event_type
ORDER BY event_type;
```

Verified result:

```text
event_type       event_count
auction.created  1
auction.sold     1
auction.started  1
bid.accepted     1
bid.rejected     99
order.created    1
```
