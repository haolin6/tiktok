# 2026-06-10 节点 4 最终验收清单

本清单用于最终提交前自查和审批 agent 复验。验收以 `docs/2026-06-10-node4-spec.md` 为总控标准；如果代码、脚本、页面和文档冲突，以当前代码和可执行命令为准，不用文档冒充已完成功能。

## P0 总览

| 编号 | P0 项 | 必须通过的证据 | 阻塞标准 |
|---|---|---|---|
| P0-1 | 冻结功能基线 | 环境、测试、构建、E2E、页面主链路 | 任一业务回归未解释或未修复 |
| P0-2 | 完整演示脚本 | `docs/2026-06-10-demo-script.md` | 不能照脚本录屏，或缺页面/操作/预期/备用路线 |
| P0-3 | 技术文档 | `docs/2026-06-10-technical-defense.md` | 架构/状态机/数据库/一致性讲不清，或写了未实现能力 |
| P0-4 | 并发验收证据 | 四种 `demo:concurrency` 模式和 MySQL 行数 | `orderCount`、bid rows、event rows 不符合模式预期 |
| P0-5 | 录屏材料清单 | 演示脚本中的录屏素材表 | 不知道失败时补录哪一段 |
| P0-6 | 最终提交前检查 | git 状态、密钥扫描、文档边界 | 真实密钥入库或为了清理状态回滚别人改动 |

## P0-1 功能冻结命令

在项目根目录执行：

```bash
npm run check:env
npm run redis:ping
npm run db:mysql:ping
npm run test
npm run build
npm run test:e2e
```

通过标准：

- `npm run check:env`：Node.js、npm、MySQL CLI、Redis CLI 为 OK；Docker 可为 OPTIONAL。
- `npm run redis:ping`：输出 `PONG`。
- `npm run db:mysql:ping`：输出 `mysqld is alive`。
- `npm run test`：shared 和 api 测试通过，覆盖 HTTP 主链路、拒绝出价、重复请求、自动延时、终态结算、WebSocket 隔离和 Redis 幂等。
- `npm run build`：shared、api、web 构建通过。
- `npm run test:e2e`：Playwright 双页面实时链路通过，并覆盖成交和支付。

失败处理：

- 环境问题：说明缺失服务、端口、CLI 或 `.env` 配置，并给出恢复命令。
- 测试问题：说明是测试 flake、依赖启动时序还是断言过旧。
- 业务回归：必须修复后再进入最终提交。

## P0-1 浏览器主链路

启动服务：

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

浏览器路径和验收点：

| 路径 | 操作 | 成功看什么 |
|---|---|---|
| `/admin/auctions/new` | 填写商品和规则，点击 `创建并开始` | 返回 `竞拍 #<auctionId>`，状态 `Running`，出现 `进入直播间` |
| `/admin/auctions` | 查看列表，必要时点击 `开始` | 能看到竞拍 ID、状态、当前价、结束时间、直播间入口 |
| `/live/:roomId` | 两个窗口分别选择 `竞拍用户 A` 和 `竞拍用户 B`，交替出价 | 当前价、领先者、最近出价、排行榜实时同步；连接状态 `connected` |
| `/live/:roomId` | 最后 10 秒附近出价 | 出现自动延时提示或服务端快照 endAt 更新 |
| `/live/:roomId` | 达封顶价或等待到期 | 状态变为 `Sold` 或 `Passed`；有赢家时出现订单 |
| `/pay/:orderId` | 点击 `模拟支付` | 订单状态变为 `paid`，直播间可收到 `order.paid` 提示 |
| `/admin/orders` | 查看后台订单 | 订单 ID、商品、买家、金额、状态正确 |
| `/me/orders` | 选择赢家用户 | 该用户能看到订单和出价历史 |

边界：

- 管理端当前没有独立 `/admin/auctions/:id` 页面，不把它写成演示路径。
- 管理端当前没有取消按钮；取消通过 `POST /api/auctions/:id/cancel`、状态、事件和 SQL 验收。
- 终态 `Sold`、`Passed`、`Canceled` 不允许继续出价；按钮不可用或 API 拒绝是正确行为。

## P0-2 演示脚本验收

文件：`docs/2026-06-10-demo-script.md`

检查项：

- 有 10-15 分钟顺序。
- 每一步都有页面路径或命令。
- 每一步都有操作、预期现象、备用路线。
- 明确主播/后台、用户 A、用户 B。
- 明确哪些现场演示，哪些是备用 SQL/命令证据。
- 录屏片段建议覆盖功能、并发、技术说明。

阻塞项：

- 脚本要求打开不存在页面。
- 脚本把 API 能力写成页面能力。
- 脚本没有失败兜底。

## P0-3 技术文档验收

文件：`docs/2026-06-10-technical-defense.md`

检查项：

- Mermaid 架构图包含 Web、API、Socket.IO、Redis、MySQL、并发脚本。
- 状态机只包含当前代码枚举：`Draft`、`Scheduled`、`Running`、`Sold`、`Passed`、`Canceled`。
- 自动延时说明为 `Running` 内更新 `end_at` 和广播 `auction.extended`，不是虚构 `Extended` 状态。
- 数据库 7 表职责说明完整：`users`、`products`、`auction_rooms`、`auctions`、`bids`、`orders`、`auction_events`。
- WebSocket 房间隔离和重连策略引用 `docs/websocket_event_protocol.md`。
- 三层一致性说明 Redis lock、Redis idempotency key、MySQL unique/order transaction。
- 常见问答不宣称真实直播流、真实支付、复杂鉴权或大规模压测已完成。

阻塞项：

- 写出代码里不存在的事件、页面、状态或命令。
- 无法说明为什么不会重复成交、重复支付或跨房间串消息。

## P0-4 并发模式验收

逐条执行：

```bash
npm run demo:concurrency -- --mode=unique
npm run demo:concurrency -- --mode=duplicate-accepted
npm run demo:concurrency -- --mode=duplicate-rejected
npm run demo:concurrency -- --mode=lock-busy
```

每条输出必须包含：

```text
mode=...
redis=PONG
auctionId=...
attempts=...
accepted=...
rejected=...
duplicate=...
lockBusy=...
businessRejected=...
durationMs=...
finalStatus=...
finalPrice=...
finalWinnerId=...
orderCount=...
acceptedBidRows=...
rejectedBidRows=...
lockBusyBidRows=...
acceptedEventRows=...
rejectedEventRows=...
eventCounts=...
```

模式标准：

| 模式 | 必须满足 |
|---|---|
| `unique` | `attempts=100`、`accepted=1`、`rejected=99`、`finalStatus=Sold`、`finalPrice=109`、`orderCount=1`、`acceptedBidRows=1`、`rejectedBidRows=99`、`rejectedEventRows=99` |
| `duplicate-accepted` | 第一次成功，后续 `DUPLICATE_ATTEMPTS - 1` 次为幂等回放；`acceptedBidRows=1`、`acceptedEventRows=1`、`finalPrice=109` |
| `duplicate-rejected` | 第一次业务拒绝，后续重复请求不新增 rejected bid/event；`rejectedBidRows=1`、`rejectedEventRows=1`、`finalPrice=99` |
| `lock-busy` | `lockBusy=1`、`lockBusyBidRows=1`、`rejectedBidRows=1`、`rejectedEventRows=1`、`acceptedBidRows=1`、`finalPrice=109` |

参数透传检查：

- 根 `package.json` 必须包含：

```json
"demo:concurrency": "npm run demo:concurrency -w @live-auction/api --"
```

- 如果输出没有 `mode=<目标模式>`，则该次验收无效。

## P0-4 MySQL 证据

把并发输出的 `<auctionId>` 代入：

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

验收标准：

- SQL 的 `order_count` 等于脚本 `orderCount`。
- SQL 的 accepted/rejected/lock busy bid 行数等于脚本输出。
- `auction_events` 与脚本 `eventCounts` 一致。
- 成交链路至少能看到 `bid.accepted`、`auction.sold`、`order.created`。
- 拒绝链路能看到 `bid.rejected`。

## P0-5 录屏素材验收

录屏必须能覆盖：

| 素材 | 必须出现 |
|---|---|
| 环境启动 | `check:env`、Redis/MySQL ping、`npm run dev` |
| 后台发布 | `/admin/auctions/new` 表单、`创建并开始`、竞拍 ID |
| 双端实时 | 两个 `/live/:roomId` 窗口、A/B 出价、价格和排行榜同步 |
| 延时/成交 | `auction.extended` 提示或成交结果 |
| 支付 | `/pay/:orderId`、`模拟支付`、`paid` |
| 订单查看 | `/admin/orders`、`/me/orders` |
| 并发证明 | 四种 `demo:concurrency` 输出 |
| 技术说明 | 架构图、状态机图、三层一致性、AI 使用说明 |

失败补录标准：

- 缺功能链路：补录对应页面片段。
- 缺并发证据：补录对应模式终端输出。
- 缺技术解释：补录 Mermaid 图和问答说明。
- 缺密钥检查：补录扫描命令和结果摘要。

## P0-6 密钥和提交前检查

基础检查：

```bash
git status --short
rg -n "sk-|api[_-]?key|secret|password|token" .env* docs apps packages infra scripts package.json
```

验收标准：

- `.env` 不应提交。
- `.env.example` 只能保留占位值，例如 `change_me`、空的 `ARK_API_KEY=`。
- 文档中出现 `password`、`token`、`API Key` 等词时，必须是安全约束或示例字段，不是真实凭据。
- 不为了清理 git 状态回滚别人改动。
- 不删除用户未确认的本地文件。

如果扫描命中：

| 命中类型 | 处理 |
|---|---|
| `.env.example` 占位字段 | 标注为示例，不阻塞 |
| docs 中的安全说明 | 标注为安全约束，不阻塞 |
| 真实 `sk-`、`ark-`、云密钥、个人 token | P0 阻塞，必须移出仓库并轮换 |
| 本地 `.env` 命中 | 确认未被 git 跟踪；不要在文档或最终回复暴露值 |

## P1 验收

| 项 | 证据 | 不通过时是否阻塞 |
|---|---|---|
| 答辩 Q&A | `docs/2026-06-10-technical-defense.md` 常见问答 | 不阻塞 P0，除非影响 P0 解释 |
| AI 使用说明 | `docs/2026-06-10-ai-usage-and-review.md` | 不阻塞 P0，除非虚构未发生人工操作 |
| 并发结果摘要 | 四种命令输出和 SQL 抽查 | 若 P0 并发命令失败则阻塞 |
| 管理端事件日志/监控卡片 | 仅当页面已有才演示 | 当前不作为 P0 阻塞 |

## P2 验收

P2 不进入节点 4 阻塞项：

- 更精致样式。
- 更完整数据看板。
- 更复杂压测图表。
- 真实直播流。
- 复杂鉴权。

如果这些内容没有完成，答辩时只能作为边界说明，不能冒充已交付。

## 审批 Agent 复验格式

```text
审批结论：通过 / 不通过
P0 阻塞项：
- ...
P1 建议项：
- ...
需要修改 agent 处理的文件：
- ...
复验命令：
- ...
```

通过条件：

- P0 阻塞项为空。
- 文档和当前代码/脚本命名一致。
- 未发现真实密钥。
- 未把未完成能力写成已完成。
