# 最终验收日志

日期：2026-06-10

本日志记录挑战赛反馈修补后的本机验收。执行环境为 `/Users/haolin6/Documents/tiktok`，本地 MySQL 8.0 和 Redis 已启动。

## 前置检查

### `npm run check:env`

结果：通过。

摘要：

```text
OK Node.js v22.17.0
OK npm 10.9.2
OK MySQL CLI
OK Redis CLI
OK .env.example includes MySQL and Redis keys.
```

说明：`check:env` 只证明工具链和环境文件存在，不证明 MySQL/Redis 当前正在运行。

### `npm run db:mysql:ping`

结果：通过。

摘要：

```text
mysqld is alive
```

### `npm run redis:ping`

结果：通过。

摘要：

```text
PONG
```

说明：在 Codex 沙箱内直接 ping Redis 曾返回本机网络权限错误；提权后 `db:mysql:ping` 和 `redis:ping` 均通过，证明本机服务实际可用。

## 构建和测试

### `npm run build`

结果：通过。

摘要：

```text
@live-auction/shared build: tsc -p tsconfig.json
@live-auction/api build: tsc -p tsconfig.json
@live-auction/web build: tsc -p tsconfig.json && vite build
✓ built
```

### `npm run test`

结果：通过。

摘要：

```text
packages/shared: 2 files passed, 5 tests passed
apps/api: 1 file passed, 14 tests passed
```

新增覆盖点：

- `PATCH /api/auctions/:id` 仅允许修改 `Scheduled` 竞拍规则。
- `Running`、`Sold`、`Passed`、`Canceled` 修改被拒绝。
- 空 body 和未知字段被拒绝。
- `user.outbid` 只定向给 previous winner。
- `bid.accepted.payload.previousWinnerId` 与 MySQL `auction_events` 一致。

### `npm run test:e2e`

结果：通过。

摘要：

```text
Running 6 tests using 1 worker
6 passed
```

新增覆盖点：

- 双页面出价同步、成交、支付和移动端布局。
- 后台列表取消运行中竞拍。
- A 被 B 超越后显示被超越提示。
- 流拍时直播间显示“竞拍已流拍，无人成交”，且不显示支付入口。
- 发布页填写自动延时参数并落到 API。
- 后台列表进入未开始竞拍编辑页，修改规则后 API 持久化。

端口说明：Playwright 配置 `reuseExistingServer = false`。执行前已确认旧的 `3000/4000` dev server 进程并释放端口，否则会被端口占用阻断。

## 并发一致性脚本

### `npm run demo:concurrency -- --mode=unique`

结果：通过。

摘要：

```text
attempts=100
accepted=1
rejected=99
lockBusy=76
finalStatus=Sold
orderCount=1
acceptedBidRows=1
rejectedBidRows=99
acceptedEventRows=1
rejectedEventRows=99
```

### `npm run demo:concurrency -- --mode=duplicate-accepted`

结果：通过。

摘要：

```text
attempts=10
accepted=1
duplicate=9
acceptedBidRows=1
acceptedEventRows=1
```

### `npm run demo:concurrency -- --mode=duplicate-rejected`

结果：通过。

摘要：

```text
attempts=10
accepted=0
rejected=10
duplicate=9
rejectedBidRows=1
rejectedEventRows=1
```

### `npm run demo:concurrency -- --mode=lock-busy`

结果：通过。

摘要：

```text
attempts=2
accepted=1
rejected=1
lockBusy=1
acceptedBidRows=1
rejectedBidRows=1
lockBusyBidRows=1
```

## Fanout 脚本

### `npm run demo:realtime-fanout -- --clients=100`

结果：通过。

摘要：

```text
clients=100
connected=100
subscribed=100
broadcastReceived=100
broadcastFailures=0
p95Ms=22
```

### `npm run demo:realtime-fanout -- --clients=200`

结果：通过。

摘要：

```text
clients=200
connected=200
subscribed=200
broadcastReceived=200
broadcastFailures=0
p95Ms=35
```

## 材料风险

- 线上 Demo：未部署。
- 1000+ 在线：未做线上级压测；当前只有本机 100/200 fanout 证明。
- 演示视频：旧视频链接已移除，已替换为 B 站公开视频链接。
- 业务运行时 AI：未接入大模型 API，AI 只用于开发协作和交付材料整理。
