# 2026-06-10 挑战赛交付完善方案

## 目标

针对挑战赛完成度检查意见，按 核心 / 增强 / 补充 梯度完善当前仓库。完善目标不是扩大项目边界，而是把已经接近完成的直播竞拍全栈链路补到更可展示、更可验证、更符合宣讲版要求的状态。

完成后需要达到：

- 核心：必补缺口关闭，验收者能从代码、页面、测试和文档看到明确证据。
- 增强：体验、性能证明和答辩材料更有说服力。
- 补充：可选材料补强，降低演示和外部访问风险。

## 当前仓库环境

仓库路径：`/Users/haolin6/Documents/tiktok`

技术栈：

- Frontend：React 19 + Vite + TypeScript
- Backend：Fastify + Socket.IO + TypeScript
- Data：MySQL 8.0 + Redis
- Test：Vitest + Playwright
- Package manager：npm workspaces

当前关键脚本：

```bash
npm run check:env
npm run db:migrate
npm run db:seed
npm run dev
npm run build
npm run test
npm run test:e2e
npm run demo:concurrency -- --mode=unique
npm run demo:concurrency -- --mode=duplicate-accepted
npm run demo:concurrency -- --mode=duplicate-rejected
npm run demo:concurrency -- --mode=lock-busy
```

默认本地地址：

- Web：`http://127.0.0.1:3000`
- API：`http://127.0.0.1:4000`

当前已有基础：

- 后台创建竞拍、启动、取消、订单查看。
- 用户直播间出价、当前价、下一口价、倒计时、领先者、排行榜、成交支付入口。
- Socket.IO 房间隔离、断线重连后 snapshot 恢复。
- Redis lock、Redis 幂等 key、MySQL 事务和唯一约束。
- API 集成测试、Playwright E2E、四种并发一致性脚本。

## 修改边界

允许修改：

- `packages/shared/src/api-types.ts`
- `packages/shared/src/realtime-types.ts`
- `apps/api/src/routes/auctions-routes.ts`
- `apps/api/src/services/auctions-service.ts`
- `apps/api/src/repositories/auctions-repository.ts`
- `apps/api/src/realtime/realtime-hub.ts`
- `apps/api/src/test/api.integration.test.ts`
- `apps/api/src/test/realtime-test-helpers.ts`（如需要拆分或扩展实时测试 helper）
- `apps/api/src/scripts/*`
- `apps/web/src/App.tsx`
- `apps/web/src/styles.css`
- `apps/web/src/test/live-room.e2e.ts`
- `package.json`
- `apps/api/package.json`
- `package-lock.json`
- `README.md`
- `docs/*.md`

原则：

- 不新增数据库表，核心 完善应复用现有 `auctions`、`auction_events`、`bids`、`orders`。
- 默认不引入新的运行时依赖；如增强 fanout 脚本需要 `socket.io-client`，必须在对应任务中说明并保持最小范围。
- 不改真实支付、真实直播、复杂鉴权、网关、物流等当前边界外能力。
- 不为了测试通过删除或放宽已有状态机、幂等和并发约束。

## 非目标与范围说明

以下完善点不建议直接作为本轮代码完善目标，除非后续版本单独纳入：

| 项 | 不建议直接补的原因 | 本轮替代方案 |
|---|---|---|
| 线上 Demo 部署 | 需要部署前端、API、MySQL、Redis、CORS、迁移、密钥和稳定性，成本明显高于当前版本完善范围 | README 写清本地运行和演示视频，补最终验收日志 |
| 真实图片文件上传 | 需要 multipart、文件存储、访问 URL、清理策略或对象存储 | 把文案改成“商品图片 URL/素材地址”，不伪装成上传 |
| 1000+ 在线硬压测 | 是加分项，且本机长连接压测结果不等于线上稳定性 | 做 100/200 连接 fanout 轻量证明，并说明 1000+ 是边界 |
| 运行时大模型链路 | 竞拍核心风险是状态机、实时同步和一致性，强接模型容易牵强 | 补 `ai_usage_evidence.md` 证明 AI 全栈开发过程 |

## 核心 完善项

### 核心-1 AI 使用证据文档

完善点：AI 使用目前偏描述，缺少可追溯证据。

修改方向：

- 新增 `docs/ai_usage_evidence.md`。
- 更新 `README.md` 文档索引和 AI 说明。
- 必须说明 AI 在开发流程中，不在用户出价、竞拍结算、订单支付或 WebSocket 运行时链路中。

文档结构：

- AI 工具使用位置：需求拆解、方案设计、编码、测试、文档、排错。
- 3-5 个关键 AI 指令 摘要：不需要贴隐私或完整对话，但要能说明目标、约束、验收命令。
- AI 参与模块：前端、后端、实时协议、Redis/MySQL、测试、文档。
- 人工把控点：状态机、并发一致性、幂等、密钥安全、范围取舍。
- AI 代码参与口径：说明协作范围即可，强调关键决策人工把控。
- 最终证据链：源码文件、测试命令、页面路径、MySQL/Redis 证据、演示视频。

验收标准：

- `README.md` 能直接链接到 `docs/ai_usage_evidence.md`。
- 文档不宣称运行时调用大模型 API。
- 文档回答评分项中的“AI 使用流程是否规范、可追溯”。

### 核心-2 最终验收日志文档

完善点：`docs/project_delivery_summary.md` 里记录过 `npm run test:e2e` 被端口占用阻断，容易造成最终验收状态不清晰。

修改方向：

- 新增 `docs/final_acceptance_log.md`。
- 实际重跑并记录以下命令结果：

```bash
npm run check:env
npm run db:mysql:ping
npm run redis:ping
npm run build
npm run test
npm run test:e2e
npm run demo:concurrency -- --mode=unique
npm run demo:concurrency -- --mode=duplicate-accepted
npm run demo:concurrency -- --mode=duplicate-rejected
npm run demo:concurrency -- --mode=lock-busy
```

- 更新 `docs/project_delivery_summary.md` 的验收状态，删除或改写过期的 E2E 阻断描述。
- 更新 `README.md` 文档索引。
- 说明 `check:env` 只检查工具链和环境文件，不证明 MySQL/Redis 当前正在运行；`db:mysql:ping` 与 `redis:ping` 才是本机服务存活检查。
- 说明 Playwright `webServer.reuseExistingServer = false`，执行 `npm run test:e2e` 前必须确认 `3000/4000` 没有旧服务占用。

验收标准：

- 最新日志包含日期、命令、结果和关键输出摘要。
- 如果某条命令因本机服务、数据库或 Redis 状态失败，必须写明失败原因和下一步，不得写成通过。
- `project_delivery_summary.md` 与最新验收日志一致。

### 核心-3 `user.outbid` 端到端落地

完善点：共享协议和技术答辩列了 `user.outbid`，但当前没有服务端 emit，前端也没有监听。

修改方向：

- 在 `PlaceBidResponse` 增加 `previousWinnerId: number | null`。
- `processBidWithMysqlLock` 在新出价成功时填入事务内捕获的 `previousWinnerId`。
- `responseFromExistingBid` 用于幂等回放；幂等回放不触发 `publishBidAccepted`，`previousWinnerId` 可填 `null`。
- `processBidWithMysqlLock` 已经在 `auction_events` 的 `bid.accepted` payload 里记录 `previousWinnerId`，本轮需要保证 HTTP/Socket response、实时 payload 和 MySQL 事件事实一致。
- `realtime-hub.ts` 中，当 `previousWinnerId !== null && previousWinnerId !== newWinnerId` 时，向 `user:${previousWinnerId}` 单独发送 `user.outbid`。
- `App.tsx` 监听 `user.outbid`，仅当前用户被超越时展示“被超越”类提示。
- `styles.css` 增加被超越提示的视觉状态。

测试要求：

- API/WebSocket 集成测试：用户 A 先出价，用户 B 再出价，A 收到 `user.outbid`。
- 同一竞拍中，新领先者 B 不收到自己的 `user.outbid`。
- 非 previousWinner 用户、其他房间用户、未 join 用户不收到该事件。
- 测试对比最新 `auction_events` 中 `bid.accepted.payload_json.previousWinnerId`，保证定向实时事件和 MySQL 事件事实一致。
- 前端 E2E：A 页面被 B 超越后出现被超越提示。

验收标准：

- `docs/websocket_event_protocol.md`、`docs/technical_defense.md` 中 `user.outbid` 与真实实现一致。
- `npm run test` 通过。
- `npm run test:e2e` 通过。

### 核心-4 `auction.passed` 前端展示补齐

完善点：后端已支持 `auction.passed`，测试也覆盖了部分广播，但用户端没有显式监听和展示。

修改方向：

- `App.tsx` 监听 `auction.passed`。
- 流拍时展示明确提示，例如“竞拍已流拍，无人成交”。
- 当 `snapshot.auction.status === "Passed"` 且没有 `order` 时，也显示结果区域，避免页面只剩不可出价按钮。
- `styles.css` 增加流拍结果样式，可复用已有 `result-panel compact`。

测试要求：

- API 集成测试继续覆盖 `auction.passed` 事件和无订单。
- Playwright 必须覆盖直播间显示“竞拍已流拍，无人成交”且不显示支付入口。
- 为避免同一 demo room 里旧的 Sold/Running 竞拍抢占 `selectAuctionForRoom`，实现时需二选一：
  - 让 `/live/:roomId` 支持 `?auctionId=<id>` 指定竞拍。
  - 或在 E2E 中创建独立测试 room。
- 确认流拍不会展示支付入口。

验收标准：

- 用户直播间能看到 `auction.passed` 对应结果。
- `npm run test:e2e` 通过。

### 核心-5 发布页暴露自动延时参数

完善点：后端和数据库已有 `extendThresholdSec`、`extendDurationSec`，但发布页没有让验收者看到规则配置能力。

修改方向：

- `NewAuctionForm` 增加：
  - `extendThresholdSec`
  - `extendDurationSec`
- `/admin/auctions/new` 增加两个输入框：
  - 延时触发阈值秒
  - 每次延长秒数
- 提交 `/api/auctions` 时带上这两个字段。
- 直播间或管理列表可展示当前竞拍的延时规则摘要，优先在直播间 metric/rule 区轻量展示。

测试要求：

- Playwright 从 `/admin/auctions/new` 填写两个延时字段并创建竞拍。
- Playwright 通过 `GET /api/auctions/:id` 或列表断言字段已进入后端。
- 已有自动延时测试继续通过。

验收标准：

- 验收者在发布页能看到“延时机制”配置。
- `npm run build` 和 `npm run test:e2e` 通过。

### 核心-6 支持修改未开始竞拍规则

完善点：宣讲版要求“支持修改未开始竞拍的规则”，当前没有 PATCH/PUT 路由，也没有前端编辑入口。

修改方向：

共享类型：

- 在 `packages/shared/src/api-types.ts` 增加：
  - `UpdateAuctionRequest`
  - `UpdateAuctionResponse`
- `UpdateAuctionRequest` 是 partial；允许字段都可选，但 body 必须 `minProperties: 1`。
- `ceilingPrice` 允许 `number | null`；未传字段保持原值，传 `null` 才清空封顶价。

后端：

- 在 `auctions-routes.ts` 增加 `PATCH /api/auctions/:id`。
- 请求字段允许：
  - `startPrice`
  - `incrementStep`
  - `ceilingPrice`
  - `startAt`
  - `endAt`
  - `extendThresholdSec`
  - `extendDurationSec`
- `additionalProperties: false`。
- 只允许 `Scheduled` 状态修改。
- `Running`、`Sold`、`Passed`、`Canceled` 必须返回冲突错误。
- 修改时复用 `createAuction` 的价格和时间校验规则。
- 因 Scheduled 阶段还没有有效出价，更新 `startPrice` 时同步更新 `current_price = startPrice`。
- 写入 `auction_events`，事件类型建议为 `auction.updated`，payload 包含 `auctionId`、修改前后关键字段。
- 新增 `updateAuction` service：开启事务，`findAuctionByIdForUpdate` 锁行，确认状态仍为 `Scheduled`，合并旧值和新值后校验，调用 repository 更新，写入事件，提交。

Repository：

- 在 `auctions-repository.ts` 增加更新函数，使用 `WHERE id = ? AND status = 'Scheduled'` 兜底。
- 更新成功后返回最新 `AuctionDto`。

前端：

- 在 `/admin/auctions` 的 `Scheduled` 行显示“编辑”入口。
- 新增 `/admin/auctions/:id/edit` 页面。
- 编辑页加载 `GET /api/auctions/:id`，复用或模仿发布页的规则表单。
- 编辑页只编辑竞拍规则，不编辑商品标题、图片、介绍；商品编辑不属于本轮 核心。
- `App()` 中 `/admin/auctions/:id/edit` 分支必须放在通用 `/admin/auctions` 分支之前，否则会被列表页提前匹配。

测试要求：

- API 集成测试：
  - Scheduled 竞拍可修改规则。
  - 修改 `startPrice` 后 `currentPrice` 同步。
  - `ceilingPrice < startPrice` 被拒绝。
  - `endAt <= startAt` 被拒绝。
  - Running 竞拍修改被拒绝。
  - Sold、Passed、Canceled 竞拍修改均被拒绝。
  - 空 body 被拒绝。
  - 未知字段被 `additionalProperties: false` 拒绝。
- E2E：
  - 后台列表进入 Scheduled 竞拍编辑页，修改规则后回到列表或展示成功结果。

验收标准：

- 验收者能从页面完成“未开始竞拍规则修改”。
- 运行中竞拍和终态竞拍不能被改。
- `npm run build`、`npm run test`、`npm run test:e2e` 通过。

### 核心-7 文档事实一致性修订

完善点：现有文档中存在“已写入文档但代码/页面尚未完全落地”的风险，例如 `technical_defense.md` 列了 `user.outbid`，`project_delivery_summary.md` 写了延时参数能力，但检查意见指出发布页未暴露。

修改方向：

- 统一更新：
  - `README.md`
  - `docs/project_delivery_summary.md`
  - `docs/technical_defense.md`
  - `docs/websocket_event_protocol.md`
- 只把已实现能力写成已完成。
- 把以下能力标注为 2026-06-10 修补后能力：
  - `user.outbid` 定向被超越提醒。
  - `auction.passed` 前端流拍展示。
  - 发布页延时参数配置。
  - 未开始竞拍规则编辑。
- 移除或改写过期 E2E 阻断描述。
- 继续明确以下边界：
  - 线上 Demo 未部署。
  - 1000+ 在线未做线上级压测。
  - 真实直播、真实支付、复杂鉴权不在当前版本。
  - 业务运行时未接入大模型 API。

验收标准：

- 文档、代码和测试事实一致。
- 不把 增强/补充 未完成项写成已完成。
- README 的“当前边界”与验收日志一致。

## 增强 完善项

### 增强-1 倒计时精度和最后阶段氛围

完善点：当前倒计时是秒级，氛围偏功能型。

修改方向：

- `LiveRoomPage` 计时器从 1000ms 改成 100ms 或 250ms。
- 新增 `formatRemainingTime`，显示 `mm:ss.S` 或 `ss.Ss`。
- 当剩余时间 <= 10 秒时增加紧张态 class。
- `styles.css` 增加：
  - 当前价轻微跳动。
  - 最后 10 秒倒计时高亮。
  - 成功出价、被超越、自动延时分别使用不同提示样式。

验收标准：

- 移动端和桌面端文本不溢出。
- E2E 移动端布局检查继续通过。

### 增强-2 竞价氛围反馈增强

完善点：领先、被超越、延时、成交的视觉反馈不够强。

修改方向：

- 出价成功：当前用户显示“领先中”提示。
- 被超越：`user.outbid` 触发醒目但不遮挡主流程的提示。
- 自动延时：显示新结束时间和延长秒数。
- 成交/流拍：终态结果区域更明确。
- 提示音可选，不作为 增强 必须项；若做，只能在用户完成出价交互后触发，避免浏览器自动播放限制。

验收标准：

- 不引入复杂动画库。
- 不牺牲已有页面响应式布局。

### 增强-3 轻量 WebSocket fanout 证明

完善点：并发脚本证明了出价一致性，但没有证明多连接广播能力。

优先级说明：

- 若只交付 核心，只能称为核心功能缺口完善完成，不能称为性能证明已关闭。
- 若目标是关闭挑战赛完成度反馈中的性能证明问题，增强-3 和 增强-4 必须完成。
- 100/200 fanout 是轻量广播证明，1000+ 在线仍列为当前边界。

修改方向：

- 新增轻量脚本，例如 `apps/api/src/scripts/simulate-realtime-fanout.ts`。
- 新增 root script，例如：

```json
"demo:realtime-fanout": "npm run demo:realtime-fanout -w @live-auction/api --"
```

- `apps/api/package.json` 增加：

```json
"demo:realtime-fanout": "tsx src/scripts/simulate-realtime-fanout.ts"
```

- 脚本目标：
  - 创建或复用 demo room、auction、users。
  - 建立 100 或 200 个 Socket.IO 连接。
  - join room + subscribe auction。
  - 触发一次有效出价。
  - 统计收到 `bid.accepted` 或 `auction.snapshot` 的客户端数、耗时、p50/p95/p99。
- 脚本必须自启动测试服务：
  - 创建 `DbPool`、Redis、Fastify app、`RealtimeHub`。
  - attach 后 listen `127.0.0.1:0` 获取随机端口。
  - 使用 `socket.io-client` 建立客户端连接。
  - 出价必须通过 socket `bid.place` 或 HTTP `/api/auctions/:id/bids` 触发真实 publish。
  - 不允许直接调用 service 后跳过广播。
  - 结束时关闭所有 sockets、hub、app、pool、redis。

依赖说明：

- 如果脚本需要 `socket.io-client`，应在 `apps/api/package.json` 明确添加最小依赖或 devDependency，并更新 lockfile。
- 不要求 1000+ 本地硬压测。

验收标准：

- 新增 `docs/performance_evidence.md` 记录代表性输出。
- README 说明 100/200 fanout 是轻量证明，1000+ 是未完成边界。

### 增强-4 性能和一致性证据表

完善点：`docs/concurrency_demo.md` 只有代表性输出，没有便于验收阅读的指标表。

优先级说明：

- 该项与 增强-3 共同关闭“性能/高并发证明不足”反馈。
- 若未完成，只能在最终材料中诚实声明当前已有一致性证明，fanout/千级在线证明未关闭。

修改方向：

- 更新 `docs/concurrency_demo.md` 或新增 `docs/performance_evidence.md`。
- 汇总：
  - 四种 `demo:concurrency` 模式。
  - attempts、accepted、rejected、duplicate、lockBusy、durationMs。
  - orderCount、acceptedBidRows、rejectedBidRows、eventCounts。
  - 如 fanout 脚本完成，追加 fanout 连接数、收到广播数、p95。

验收标准：

- 文档明确区分“一致性验证”和“线上千级压测未覆盖”。
- 不写成本地数据。

## 补充 完善项

### 补充-1 内测/评审记录

完善点：仓库缺少内测记录。

修改方向：

- 新增 `docs/internal_review_notes.md`。
- 记录一次本地内测路径：
  - 后台发布。
  - 编辑未开始规则。
  - 双用户直播间出价。
  - 被超越提醒。
  - 自动延时。
  - 成交/流拍。
  - 模拟支付。
  - 并发脚本。
- 记录发现问题、处理结果和剩余边界。

验收标准：

- 文档是事实记录，不写成虚构用户调研。
- README 可选链接。

### 补充-2 演示视频访问说明

完善点：历史演示视频链接外部访问权限未知，现已替换为重录后的 B 站公开视频链接。

修改方向：

- README 增加演示视频访问说明：
  - 当前视频链接。
  - 若外部验收者无法访问，需要备用公开链接。
- 如果存在备用链接，再更新 README 和 `docs/project_delivery_summary.md`。

验收标准：

- 不伪造公开视频链接。
- 明确需要视频访问权限检查。
- 提交前必须确认演示视频外部可访问；当前 README 和交付总结使用 B 站公开视频链接。

## 最终验收门槛

核心 完成后必须通过并记录到 `docs/final_acceptance_log.md`：

```bash
npm run check:env
npm run db:mysql:ping
npm run redis:ping
npm run build
npm run test
npm run test:e2e
npm run demo:concurrency -- --mode=unique
npm run demo:concurrency -- --mode=duplicate-accepted
npm run demo:concurrency -- --mode=duplicate-rejected
npm run demo:concurrency -- --mode=lock-busy
```

核心 验收前置条件：

- MySQL 8.0 和 Redis 已启动。
- `.env` 已按本机配置填写。
- `3000/4000` 没有旧 dev server 占用；Playwright 会自己启动 `npm run dev`。
- 任一命令失败都不得写成通过，必须在 `docs/final_acceptance_log.md` 记录失败原因。

核心与增强 完成后必须额外通过：

```bash
npm run demo:realtime-fanout -- --clients=100
```

若声明关闭性能证明反馈，建议再跑：

```bash
npm run demo:realtime-fanout -- --clients=200
```

最终交付文档必须至少包含：

- `docs/ai_usage_evidence.md`
- `docs/final_acceptance_log.md`
- `docs/performance_evidence.md` 或更新后的 `docs/concurrency_demo.md`
- 更新后的 `README.md`
- 更新后的 `docs/project_delivery_summary.md`
- 更新后的 `docs/technical_defense.md`
- 更新后的 `docs/websocket_event_protocol.md`

提交前材料风险门槛：

- 演示视频需要确认外部可访问。
- README 和交付总结必须使用已确认的视频链接，不能保留历史链接或占位内容。

## 审核标准

两个复审视角均需给出 `PASS` 才算方案通过：

- 复审视角 A：目标一致性审核
  - 检查 核心/增强/补充 是否覆盖检查项。
  - 检查是否夸大未完成能力。
  - 检查非目标是否符合比赛得分策略。

- 复审视角 B：仓库实现/测试审核
  - 检查文件路径、脚本、端口、技术栈是否与仓库一致。
  - 检查每个完善项是否有可执行实现路径。
  - 检查验收命令是否真实可跑。
  - 检查是否会破坏状态机、幂等和并发一致性。

若任一复审视角给出 `REVISION_REQUIRED`，必须修改方案，并再次复审。
