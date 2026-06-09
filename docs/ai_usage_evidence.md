# AI 使用证据

## 定位

本项目把 AI 用在开发流程中，不把大模型接入用户出价、竞拍结算、订单支付或 WebSocket 运行时链路。竞拍结果由 Fastify 服务、Redis 幂等/锁、MySQL 事务和数据库约束决定。

## 使用位置

| 环节 | AI 辅助内容 | 人工把控 |
|---|---|---|
| 需求拆解 | 将直播竞拍课题拆成后台发布、直播间出价、实时同步、成交订单、并发一致性、演示材料 | 明确真实直播、真实支付、复杂鉴权和线上部署不是当前版本目标 |
| Spec 设计 | 为节点和反馈修补编写目标、边界、测试、验收命令 | 决定 P0/P1/P2 优先级和高成本项是否进入本轮 |
| 编码实现 | 辅助修改 React 页面、Fastify 路由、服务层、共享类型、Socket.IO hub、脚本和测试 | 校验状态机、幂等、事务和文档事实一致 |
| 测试补强 | 设计 HTTP、WebSocket、Playwright、并发脚本和负例覆盖 | 用真实命令结果判断是否通过 |
| 文档交付 | 整理 README、演示脚本、技术答辩、交付总结和最终验收日志 | 不把未完成能力写成已完成 |

## 关键 Prompt 摘要

1. 项目骨架阶段：要求基于 React/Vite、Fastify、MySQL、Redis、npm workspaces 建立直播竞拍工程骨架，并用 `/health`、MySQL schema 和环境检查脚本验收。
2. 主链路阶段：要求实现后台创建竞拍、用户出价、封顶成交、到期成交/流拍、订单生成和模拟支付，验收必须包含 HTTP 响应和 MySQL 行证据。
3. 实时与并发阶段：要求补齐 Socket.IO 房间隔离、断线恢复、Redis lock、Redis 幂等 key、MySQL 唯一约束，以及四种并发一致性脚本。
4. 测试补强阶段：要求检查测试是否过于乐观，增加拒绝出价、终态、跨房间、重复请求、锁忙和 Playwright 双页面同步。
5. 反馈修补阶段：要求按 P0/P1/P2 修补挑战赛反馈，重点补 `user.outbid`、`auction.passed` 前端展示、自动延时参数、未开始规则编辑、fanout 证明和最终验收日志。

## 关键 Prompt 模板（脱敏美化版）

以下内容根据开发过程中的多轮真实协作意图整理，做了脱敏、结构化和表达优化，不是原始聊天逐字摘录。保留它们的目的，是展示本项目如何通过高质量 prompt 控制范围、验收标准和 AI 输出质量。

### 1. 节点 Spec 设计 Prompt

```text
你现在在 `<repo-root>`。请先阅读 `docs/development_schedule.md`、已有节点 spec、当前代码结构和数据库/接口实现，再为今天的节点写一份可执行 spec。

要求：
1. 明确本节点目标、修改边界、非目标和后续节点不应提前实现的内容。
2. 每个任务都写清楚涉及文件、接口/数据表影响、测试方式和验收命令。
3. 验收不能只写 `/health` 或 `pass`，必须包含 HTTP 响应、MySQL 行证据、必要的 WebSocket/页面可见证据。
4. 如果某个实现今天省事但会增加后续成本，请先说明取舍，不要直接写代码。
5. 输出 spec 后先停下来，等我确认再进入实现。
```

### 2. 按 Spec 实现 Prompt

```text
按照刚才通过的 spec 实现，不重新扩大范围。优先沿用仓库现有 React/Vite、Fastify、Socket.IO、MySQL、Redis 和 npm workspaces 的写法。

执行要求：
1. 每改一层都补对应测试或验收脚本，保持前端、后端、共享类型和文档事实一致。
2. 并发和幂等逻辑必须以 MySQL 最终事实为准，Redis lock / idempotency key 只做短期控制。
3. 完成后运行 `npm run build`、`npm run test`，必要时补跑 `npm run test:e2e` 和并发脚本。
4. 最终汇报时不要只说测试通过，要说明终端命令、HTTP 行为、WebSocket 事件和数据库变化分别证明了什么。
```

### 3. 测试审计 Prompt

```text
请检查现有测试会不会过于乐观。不要只看 pass，要主动找没有覆盖的失败场景和真实竞拍中容易出问题的边界。

重点检查：
1. 错误用户、错误房间、未订阅 socket、跨房间广播泄漏。
2. 重复请求、锁忙、终态竞拍、封顶成交、到期流拍、取消后的非法出价。
3. WebSocket payload 是否能和 MySQL `auction_events` 行互相印证。
4. Playwright 是否能证明两个真实页面在同一个竞拍中同步变化。

请输出风险、边界条件、测试设计、验收标准和最终证明点；如果需要补测试，直接给出可执行任务。
```

### 4. 反馈修补 Prompt

```text
根据评委反馈按 P0/P1/P2 梯度设计修补 spec，并逐点检查对应问题。每个反馈点都必须有处理结果：必须修、建议修、成本过高需要讨论，或明确写入项目边界。

修补要求：
1. P0 优先修影响验收可信度的能力缺口，例如实时同步事件、成交/流拍可见结果、最终验收日志和视频路径。
2. P1 修影响评委体验和展示完整度的问题，例如规则编辑、自动延时参数、演示脚本和文档索引。
3. P2 修增强说服力但不夸大能力的材料，例如 fanout 证明、AI 使用证据、技术答辩口径。
4. 文档必须和仓库环境一致，不能把未部署线上 Demo、真实支付、真实直播或 1000+ 线上压测写成已完成。
5. 修完后用两个审核视角复查：一个看目标是否满足，一个看代码/文档是否和事实一致；审核通过后再收束。
```

### 5. 多视角工程复审 Prompt

```text
请用两个独立 agent 对这次修补做工程复审，直到复审通过。

Agent A 做目标一致性审查：检查修补结果是否覆盖原始反馈、是否符合 P0/P1/P2 优先级、是否引入了超出当前范围的新承诺。

Agent B 做事实可复现性审查：检查代码、测试、命令、页面路径和文档是否一致；尤其要挑是否把未完成能力写成已完成，或写了仓库里不存在的按钮、命令、页面。

如果任一 agent 不通过，请先按问题修改，再复审。最终输出每个问题的处理结果和通过结论。
```

### 6. 初学者验收解释 Prompt

```text
我没有基础，请把验收命令讲成体检项目。每条命令都说明：
1. 在终端怎么运行。
2. 成功输出长什么样。
3. 它对应证明了哪个 HTTP 行为、数据库变化、WebSocket 事件或页面可见结果。
4. 哪些输出只是基础健康检查，不能单独证明项目已经完成。
```

## AI 参与模块

- 前端：后台发布、竞拍列表、未开始规则编辑、直播间、订单和模拟支付页面。
- 后端：竞拍 API、出价服务、结算服务、订单服务、Socket.IO 实时 hub。
- 数据层：MySQL schema、事件表证据、Redis lock/幂等/在线状态。
- 测试：Vitest API 集成测试、Playwright E2E、并发脚本、fanout 脚本。
- 文档：README、技术答辩、交付总结、协议文档、最终验收日志。

## 人工把控点

- 竞拍状态机：`Scheduled`、`Running`、`Sold`、`Passed`、`Canceled` 的转换边界。
- 并发一致性：Redis 只做短期控制，MySQL 是最终事实来源。
- 幂等语义：同一 `auctionId + userId + requestId` 只产生一次业务结果。
- 安全边界：真实 `.env` 不提交，运行时不接入大模型 API。
- 范围取舍：线上 Demo、真实图片上传、真实支付、1000+ 在线硬压测不作为本轮代码目标。

## AI 协作口径

本项目高度使用 AI 参与代码生成、测试设计、问题排查和文档整理。人工把控集中在目标拆解、Prompt 约束、范围取舍、状态机规则、验收口径、事实修正和最终通过判定。

## 最终证据链

- 源码：`apps/web/src/App.tsx`、`apps/api/src/services/auctions-service.ts`、`apps/api/src/realtime/realtime-hub.ts`。
- 测试：`apps/api/src/test/api.integration.test.ts`、`apps/web/src/test/live-room.e2e.ts`。
- 脚本：`apps/api/src/scripts/simulate-concurrency.ts`、`apps/api/src/scripts/simulate-realtime-fanout.ts`。
- 文档：`docs/final_acceptance_log.md`、`docs/performance_evidence.md`、`docs/websocket_event_protocol.md`。
- 验收命令：`npm run build`、`npm run test`、`npm run test:e2e`、四种 `demo:concurrency`、`demo:realtime-fanout`。
