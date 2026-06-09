# WebSocket Event Protocol

## Endpoint

- Local API: `http://127.0.0.1:4000` with the Socket.IO default path.
- Local Web: `/live/:roomId` connects directly to the API WebSocket endpoint.
- Transport in this implementation is Socket.IO on the same API HTTP server, using the default Socket.IO path and the event names below.

## Client Event Shape

Clients emit a Socket.IO event with a payload and optional ack callback.

Supported client events:

- `room.join`: `{ "roomId": 1, "userId": 2 }`
- `room.leave`: `{ "roomId": 1 }`
- `auction.subscribe`: `{ "auctionId": 41 }`
- `bid.place`: `{ "auctionId": 41, "amount": 109, "requestId": "bid-1" }`

`bid.place` does not trust a client supplied `userId`. The server derives the bidder from the socket that successfully completed `room.join`. If a compatibility payload contains `userId`, it must match the joined socket user exactly.

## Ack Shape

```json
{ "ok": true, "payload": {} }
```

Failures return:

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "room.join is required before auction.subscribe."
  }
}
```

## Server Event Envelope

All server events are emitted on their event names, with this event object:

```json
{
  "type": "auction.snapshot",
  "auctionId": 41,
  "roomId": 1,
  "serverSeq": 12,
  "serverTime": "2026-06-06T15:51:22.000Z",
  "payload": {}
}
```

Supported server events:

- `auction.snapshot`
- `bid.accepted`
- `bid.rejected`
- `ranking.updated`
- `auction.extended`
- `auction.sold`
- `auction.passed`
- `auction.canceled`
- `order.paid`
- `user.outbid`
- `room.presence`

## Important Payloads

`ranking.updated`:

```json
{
  "auctionId": 41,
  "recentBids": [],
  "ranking": []
}
```

`recentBids` is the latest accepted bid stream. `ranking` is the top bidder view by amount descending and time ascending.

`auction.extended`:

```json
{
  "auctionId": 41,
  "previousEndAt": "2026-06-06T15:51:50.000Z",
  "newEndAt": "2026-06-06T15:52:05.000Z",
  "extendDurationSec": 15,
  "triggerBidId": 100
}
```

`order.paid`:

```json
{
  "auctionId": 41,
  "roomId": 1,
  "orderId": 20,
  "buyerId": 55,
  "amount": 109,
  "status": "paid",
  "paidAt": "2026-06-06T15:51:30.000Z"
}
```

## Room Isolation

- `room.join` validates an active room and a bidder user.
- `auction.subscribe` requires a successful `room.join`.
- `auction.subscribe` validates `auction.roomId === socket.roomId`.
- `bid.place` validates the same room match before calling the shared bid service.

## Reconnect Strategy

The web client keeps the latest HTTP/WebSocket snapshot on screen. On reconnect it runs:

1. `room.join`
2. `auction.subscribe`
3. Receives a fresh `auction.snapshot`

Missed events are not replayed in node 3. The authoritative recovery point is the latest MySQL-backed snapshot.
