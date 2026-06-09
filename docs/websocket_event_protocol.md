# WebSocket 事件协议

## 连接端点

- API：`http://127.0.0.1:4000`
- Web：`/live/:roomId`
- 传输：Socket.IO，挂载在 Fastify HTTP server 上。

## 客户端事件

| 事件 | Payload |
|---|---|
| `room.join` | `{ "roomId": 1, "userId": 2 }` |
| `room.leave` | `{ "roomId": 1 }` |
| `auction.subscribe` | `{ "auctionId": 41 }` |
| `bid.place` | `{ "auctionId": 41, "amount": 109, "requestId": "bid-1" }` |

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

## 服务端事件信封

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

服务端事件：

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

## 关键 Payload

`bid.accepted`:

```json
{
  "auctionId": 41,
  "bidId": 100,
  "userId": 3,
  "amount": 119,
  "requestId": "bid-2",
  "previousWinnerId": 2
}
```

`previousWinnerId` 为本次出价前的领先者。第一次有效出价时为 `null`。该字段与 `auction_events` 中 `bid.accepted.payload_json.previousWinnerId` 保持一致。

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

`auction.passed`:

```json
{
  "auctionId": 41,
  "reason": "ended"
}
```

`user.outbid`:

```json
{
  "auctionId": 41,
  "previousWinnerId": 2,
  "newWinnerId": 3,
  "amount": 119
}
```

`user.outbid` 只发送到 `user:{previousWinnerId}`。新领先者、非 previous winner、其他房间用户和未完成 `room.join` 的 socket 不应收到该事件。

## 房间隔离

- `room.join` validates an active room and a bidder user.
- `auction.subscribe` requires a successful `room.join`.
- `auction.subscribe` validates `auction.roomId === socket.roomId`.
- `bid.place` validates the same room match before calling the shared bid service.
- `user.outbid` 使用用户定向房间发送，不走整场竞拍广播。

## 重连恢复

The web client keeps the latest HTTP/WebSocket snapshot on screen. On reconnect it runs:

1. `room.join`
2. `auction.subscribe`
3. Receives a fresh `auction.snapshot`

断线期间事件不做回放。恢复后的权威状态来自 MySQL 支撑的最新 snapshot。
