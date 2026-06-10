# 最终验收日志

日期：2026-06-10

本日志记录挑战赛交付完善后的本机验收。执行环境为 `/Users/haolin6/Documents/tiktok`，本地 MySQL 8.0 和 Redis 已启动。

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
apps/api: 1 file passed, 16 tests passed
```

新增覆盖点：

- `PATCH /api/auctions/:id` 仅允许修改 `Scheduled` 竞拍规则。
- `Running`、`Sold`、`Passed`、`Canceled` 修改被拒绝。
- 空 body 和未知字段被拒绝。
- `user.outbid` 只定向给 previous winner。
- `bid.accepted.payload.previousWinnerId` 与 MySQL `auction_events` 一致。
- 多档出价、非步长拒绝、封顶截断和当前领先者继续加价。

### `npm run test:e2e`

结果：通过。

摘要：

```text
Running 8 tests using 1 worker
8 passed
```

新增覆盖点：

- 双页面出价同步、成交、支付和移动端布局。
- 后台列表取消运行中竞拍。
- A 被 B 超越后显示被超越提示。
- 流拍时直播间显示“竞拍已流拍，无人成交”，且不显示支付入口。
- 发布页填写自动延时参数并落到 API。
- 后台列表进入未开始竞拍编辑页，修改规则后 API 持久化。
- 多档加价器默认金额、`+ / -` 调整、封顶提示和成交后禁用。
- 当前领先用户继续加价、他人多档超过后的被超越提示。

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
- 演示视频：已替换为 B 站公开视频链接。
- 业务运行时 AI：未接入大模型 API，AI 只用于开发协作和交付材料整理。

## 2026-06-10 最后五项完善补充验收

最后完善内容：

- AI 人工决策表。
- README 视频亮点说明。
- 多档出价和 `+ / -` 加价器。
- 直播间竞价氛围动画与排名反馈。
- 最后小改验收记录。

### `npm run build`

结果：通过。

摘要：

```text
@live-auction/shared build: tsc -p tsconfig.json
@live-auction/api build: tsc -p tsconfig.json
@live-auction/web build: tsc -p tsconfig.json && vite build
✓ built in 527ms
```

### `npm run test -w @live-auction/shared`

结果：通过。

摘要：

```text
packages/shared: 2 files passed, 5 tests passed
```

### `npm run test -w @live-auction/api`

结果：通过。

摘要：

```text
apps/api: 1 file passed, 16 tests passed
```

补充覆盖点：

- 多档出价：支持高于下一口价的合法步长金额。
- 非步长金额拒绝，低于最新下一口价拒绝。
- 当前领先者可以继续加价。
- 超过封顶价时按封顶价接受并成交。
- 封顶价不按步长对齐时可作为终点例外。
- 幂等、被超越事件和终态拒绝继续保持回归覆盖。

### `npm run test:e2e`

结果：通过。

摘要：

```text
Running 8 tests using 1 worker
8 passed
```

补充覆盖点：

- 加价器默认选中下一口价。
- 点击 `+` 和 `-` 调整出价金额。
- 到封顶价时显示“已到封顶价”并成交后禁用出价。
- 当前领先用户继续加价后仍保持领先反馈。
- 他人多档超过后，原领先用户看到“已被超越”。
- 取消、流拍、成交终态不显示错误支付入口。

## 2026-06-10 提交前最终检查

本轮检查用于提交 GitHub 前确认代码、测试和文档状态。

### 文档检查

结果：通过。

检查项：

- 演示视频链接集中为 B 站公开视频链接。
- 材料关键词检查通过，未发现过程痕迹或占位内容。
- `README.md`、项目交付总结、演示提交文档、技术答辩材料和内部验收记录均已同步多档出价、加价器和竞价氛围反馈。

### `npm run build`

结果：通过。

摘要：

```text
@live-auction/shared build: tsc -p tsconfig.json
@live-auction/api build: tsc -p tsconfig.json
@live-auction/web build: tsc -p tsconfig.json && vite build
✓ built in 597ms
```

### `npm run test -w @live-auction/shared`

结果：通过。

摘要：

```text
packages/shared: 2 files passed, 5 tests passed
```

### `npm run test -w @live-auction/api`

结果：通过。

摘要：

```text
apps/api: 1 file passed, 16 tests passed
```

### `npm run test:e2e`

结果：通过。

说明：首次执行时发现已有本地 dev server 占用 `3000/4000`，Playwright 配置要求自启动服务，因此先释放端口后重跑。

摘要：

```text
Running 8 tests using 1 worker
8 passed
```

### `git diff --check`

结果：通过，无空白错误。
