# 2026-06-10 节点 4 最终验收报告

执行日期：2026-06-08  
执行目录：`/Users/haolin6/Documents/tiktok`  
节点目标：冻结版本、演示材料、技术文档和最终验收证据。

## 1. 验收结论

节点 4 的 P0 验收命令已经完成一轮本地验证：

- 环境检查通过。
- Redis/MySQL 本地服务可用。
- 单元/集成测试通过。
- 构建通过。
- Playwright 双页面 E2E 通过。
- 四种并发模式通过。
- `.env` 存在但被 `.gitignore` 忽略；密钥关键词扫描未发现真实密钥证据。

需要注意：

- `npm run redis:ping`、`npm run db:mysql:ping`、`npm run test`、`npm run test:e2e` 和并发脚本依赖本地端口、MySQL/Redis、`tsx` IPC，在沙箱内会触发权限限制；本报告记录的是沙箱外提权执行结果。
- 本报告不代表录屏视频文件已经产出，只代表录屏脚本和验收路径已经准备好。

## 2. 命令验收结果

| 命令 | 结果 | 关键输出摘要 |
|---|---|---|
| `npm run check:env` | 通过 | Node.js `v22.17.0`、npm `10.9.2`、MySQL CLI OK、Redis CLI OK、Docker OPTIONAL、`.env.example` OK |
| `npm run redis:ping` | 通过 | `PONG` |
| `npm run db:mysql:ping` | 通过 | `mysqld is alive` |
| `npm run test` | 通过 | shared：2 files / 5 tests；api：1 file / 12 tests |
| `npm run build` | 通过 | shared、api、web 构建通过；Vite 产出 `dist` |
| `npm run test:e2e` | 通过 | `live room keeps two pages synchronized through bids, sold state, payment, and mobile layout` 通过 |

`npm run test` 的 API 集成测试已覆盖的关键风险包括：

- start/cancel 实时广播和数据库 payload 一致性。
- `bid.rejected` 只发给失败 socket。
- 跨直播间订阅和出价隔离。
- Redis accepted/rejected/processing/lock-busy 幂等状态。
- 到期成交和流拍结算。

## 3. 并发模式验收结果

### `unique`

```text
mode=unique
redis=PONG
auctionId=200
attempts=100
accepted=1
rejected=99
duplicate=0
lockBusy=65
businessRejected=34
durationMs=259
finalStatus=Sold
finalPrice=109
finalWinnerId=49
orderCount=1
acceptedBidRows=1
rejectedBidRows=99
lockBusyBidRows=65
acceptedEventRows=1
rejectedEventRows=99
eventCounts=auction.created:1,auction.sold:1,auction.started:1,bid.accepted:1,bid.rejected:99,order.created:1
```

验收含义：

- 100 个不同用户同时抢同一口价，只接受 1 个有效出价。
- 最终只生成 1 个订单。
- MySQL bid/event 行数和脚本统计一致。

### `duplicate-accepted`

```text
mode=duplicate-accepted
redis=PONG
auctionId=199
attempts=10
accepted=1
rejected=0
duplicate=9
lockBusy=0
businessRejected=0
durationMs=138
finalStatus=Running
finalPrice=109
finalWinnerId=45
orderCount=0
acceptedBidRows=1
rejectedBidRows=0
lockBusyBidRows=0
acceptedEventRows=1
rejectedEventRows=0
eventCounts=auction.created:1,auction.started:1,bid.accepted:1
```

验收含义：

- 第一次成功出价后，后续 9 次同 `requestId` 请求走幂等回放。
- 不重复涨价，不重复写 accepted bid/event。

### `duplicate-rejected`

```text
mode=duplicate-rejected
redis=PONG
auctionId=202
attempts=10
accepted=0
rejected=10
duplicate=9
lockBusy=0
businessRejected=1
durationMs=20
finalStatus=Running
finalPrice=99
finalWinnerId=null
orderCount=0
acceptedBidRows=0
rejectedBidRows=1
lockBusyBidRows=0
acceptedEventRows=0
rejectedEventRows=1
eventCounts=auction.created:1,auction.started:1,bid.rejected:1
```

验收含义：

- 第一次业务拒绝后，后续 9 次同 `requestId` 请求走幂等回放。
- 不重复写 rejected bid/event，价格保持不变。

### `lock-busy`

```text
mode=lock-busy
redis=PONG
auctionId=201
attempts=2
accepted=1
rejected=1
duplicate=0
lockBusy=1
businessRejected=0
durationMs=226
finalStatus=Running
finalPrice=109
finalWinnerId=46
orderCount=0
acceptedBidRows=1
rejectedBidRows=1
lockBusyBidRows=1
acceptedEventRows=1
rejectedEventRows=1
eventCounts=auction.created:1,auction.started:1,bid.accepted:1,bid.rejected:1
```

验收含义：

- Redis lock 被占用时，出价按 `LOCK_BUSY` 拒绝并写 rejected bid/event。
- 锁释放后，新的合法出价可以成功。

## 4. 文档交付物

本轮新增节点 4 文档：

- `docs/2026-06-10-node4-spec.md`
- `docs/2026-06-10-demo-script.md`
- `docs/2026-06-10-technical-defense.md`
- `docs/2026-06-10-final-acceptance-checklist.md`
- `docs/2026-06-10-ai-usage-and-review.md`
- `docs/2026-06-10-final-acceptance-report.md`

这些文档覆盖：

- 节点 4 总控 spec。
- 10-15 分钟演示脚本和备用路线。
- 架构图、状态机图、数据库 7 表、WebSocket 隔离、并发一致性。
- P0/P1/P2 最终验收清单。
- AI 使用说明和审批修改追溯。
- 本轮实际命令结果摘要。

## 5. 密钥和提交前检查

检查结果：

- `rg --files -g '.env*' -g '!.git/**'` 显示本地存在 `.env.example` 和 `.env`。
- `.gitignore` 已忽略 `.env` 和 `.env.*`，并显式保留 `!.env.example`。
- `git check-ignore -v .env` 输出 `.gitignore:5:.env .env`。
- 密钥关键词扫描命中项为 `.env.example` 占位字段、文档安全说明、代码变量名和 Redis lock token 变量，未发现真实密钥证据。

扫描命令：

```bash
rg -n "sk-|api[_-]?key|secret|password|token" .env.example docs apps packages infra scripts package.json -S
```

阻塞判断：

- `.env.example` 中的 `MYSQL_PASSWORD=change_me`、`MYSQL_ROOT_PASSWORD=change_root_password`、`REDIS_PASSWORD=`、`ARK_API_KEY=` 是示例占位，不阻塞。
- docs 中出现 `password`、`token`、`API Key` 是安全检查说明，不阻塞。
- 代码中出现 `token`/`password` 是配置字段或 Redis lock token 变量，不阻塞。

## 6. 审批状态

审批 agent 第二轮复验已通过：

```text
审批结论：通过
P0 阻塞项：
- 无
```

第一轮审批曾发现 `docs/2026-06-10-technical-defense.md` 把 Redis 写成 `ranking cache`，与当前代码不一致。修改 agent 已移除该表述，并改为：Redis 负责短期锁、幂等和在线状态；排行榜/最近出价由服务端基于 MySQL `bids` 数据生成，并通过 `ranking.updated` 广播。

复验命令：

```bash
rg -n "ranking cache|排行缓存|Redis.*排行|排行.*Redis" docs/2026-06-10-technical-defense.md
```

复验结果：无匹配，说明该 P0 阻塞项已修复。
