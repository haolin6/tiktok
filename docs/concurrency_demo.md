# 并发一致性演示

## 目标

`npm run demo:concurrency` 证明并发出价不会重复涨价、重复落 bid 或重复生成订单。

WebSocket 广播 fanout 的代表性输出记录在 `docs/performance_evidence.md`。两者口径不同：本文件证明出价一致性，fanout 脚本证明本机多连接广播送达；当前版本不把这些结果夸大为线上 1000+ 在线压测。

脚本会创建独立商品、竞拍和带固定前缀的测试用户，不清空业务表，不污染手工演示竞拍。

## 四种模式

```bash
npm run demo:concurrency -- --mode=unique
npm run demo:concurrency -- --mode=duplicate-accepted
npm run demo:concurrency -- --mode=duplicate-rejected
npm run demo:concurrency -- --mode=lock-busy
```

| 模式 | 验证目标 |
|---|---|
| `unique` | 100 个不同用户同时抢同一口价，最终只有 1 个成功出价和 1 个订单 |
| `duplicate-accepted` | 同一个成功请求重复提交时只回放第一次成功结果 |
| `duplicate-rejected` | 同一个失败请求重复提交时只回放第一次拒绝结果 |
| `lock-busy` | Redis lock 被占用时返回 `LOCK_BUSY`，释放后合法请求继续成功 |

## 代表性输出

`unique` 模式的验收输出包含：

```text
redis=PONG
attempts=100
accepted=1
rejected=99
duplicate=0
finalStatus=Sold
finalPrice=109
orderCount=1
acceptedBidRows=1
rejectedBidRows=99
rejectedEventRows=99
eventCounts=auction.created:1,auction.sold:1,auction.started:1,bid.accepted:1,bid.rejected:99,order.created:1
```

## 一致性口径

- `attempts = accepted + rejected + duplicate`
- `rejected = lockBusy + businessRejected`
- `acceptedBidRows = accepted`
- `rejectedBidRows = rejected`
- `lockBusyBidRows = lockBusy`
- `orderCount = 1`

## Redis Key

出价幂等：

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

锁使用 `SET key token NX PX ttlMs`，释放时通过 Lua 校验 token。

## MySQL 证据查询

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
WHERE a.id = <auctionId>
GROUP BY a.id, a.status, a.current_price, a.current_winner_id;
```

```sql
SELECT event_type, COUNT(*) AS event_count
FROM auction_events
WHERE auction_id = <auctionId>
GROUP BY event_type
ORDER BY event_type;
```
