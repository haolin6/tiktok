# 性能和一致性证据

记录时间：2026-06-10

## 结论

当前版本已完成两类本地证明：

- 一致性证明：四种 `demo:concurrency` 覆盖并发抢同一口价、成功请求幂等回放、失败请求幂等回放、Redis lock 忙碌恢复。
- 轻量 fanout 证明：`demo:realtime-fanout` 自启动本机 API 和 Socket.IO hub，建立 100/200 个客户端，使用真实 HTTP 出价触发广播，统计广播送达和延迟。

边界：这些结果是本机开发环境证明，不等同于线上 1000+ 在线压测。当前版本仍未部署线上 Demo，也未完成线上级网关、限流、水平扩展和监控。

## 并发一致性输出

| 模式 | attempts | accepted | rejected | duplicate | lockBusy | durationMs | finalStatus | orderCount | acceptedBidRows | rejectedBidRows | event 证据 |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---|
| `unique` | 100 | 1 | 99 | 0 | 76 | 354 | Sold | 1 | 1 | 99 | `bid.accepted:1,bid.rejected:99,order.created:1` |
| `duplicate-accepted` | 10 | 1 | 0 | 9 | 0 | 78 | Running | 0 | 1 | 0 | `bid.accepted:1` |
| `duplicate-rejected` | 10 | 0 | 10 | 9 | 0 | 37 | Running | 0 | 0 | 1 | `bid.rejected:1` |
| `lock-busy` | 2 | 1 | 1 | 0 | 1 | 235 | Running | 0 | 1 | 1 | `bid.accepted:1,bid.rejected:1` |

代表性命令：

```bash
npm run demo:concurrency -- --mode=unique
npm run demo:concurrency -- --mode=duplicate-accepted
npm run demo:concurrency -- --mode=duplicate-rejected
npm run demo:concurrency -- --mode=lock-busy
```

## WebSocket Fanout 输出

100 客户端：

```text
clients=100
connected=100
subscribed=100
auctionId=317
triggerBidId=1430
triggerAmount=109
broadcastReceived=100
broadcastFailures=0
durationMs=22
p50Ms=22
p95Ms=22
p99Ms=22
```

200 客户端：

```text
clients=200
connected=200
subscribed=200
auctionId=330
triggerBidId=1439
triggerAmount=109
broadcastReceived=200
broadcastFailures=0
durationMs=35
p50Ms=33
p95Ms=35
p99Ms=35
```

脚本实现要点：

- 文件：`apps/api/src/scripts/simulate-realtime-fanout.ts`
- 命令：`npm run demo:realtime-fanout -- --clients=100`
- 自启动：创建 `DbPool`、Redis client、Fastify app、`RealtimeHub`，监听 `127.0.0.1:0` 随机端口。
- 客户端：使用 `socket.io-client` 建立连接，逐个 `room.join` 和 `auction.subscribe`。
- 触发：通过真实 HTTP `POST /api/auctions/:id/bids` 出价，不直接调用 service 跳过广播。
- 清理：结束时关闭 sockets、hub、app、pool。

## 验收口径

可以说明：当前仓库有本机 100/200 WebSocket 广播 fanout 证明，以及 100 次并发出价一致性证明。

不能夸大为：线上已经支持 1000+ 在线、已做压测平台级验证、已部署生产监控或水平扩展。
