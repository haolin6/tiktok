# 2026-06-10 AI 使用说明和人工把控记录

本文用于节点 4 答辩说明 AI 如何参与，以及如何追溯 spec、代码、测试和审批修改。本文只记录可从仓库文件、命令和本轮任务要求确认的事实；不声称已经发生未执行的人工逐行审查、未发生的录屏或未输出的审批结论。

## 1. 说明边界

可以陈述：

- 项目使用 AI 辅助进行需求拆解、节点 spec、代码实现建议、测试补充、文档整理和验收清单生成。
- AI 产物必须通过可执行命令、页面路径、MySQL 证据和审批 agent 复验来确认。
- 人工把控体现在范围冻结、关键取舍、真实密钥不入库、最终提交/录屏/答辩材料确认。

不能陈述：

- 不能说人工已经完成了未发生的逐行 code review。
- 不能说审批 agent 已通过，除非审批 agent 已实际输出通过结论。
- 不能说所有命令已通过，除非本地或主 agent 已提供对应输出。
- 不能把 AI 聊天内容当作唯一证据；必须落到 repo 文件、命令输出或数据库证据。

## 2. AI 参与范围

| 阶段 | AI 可做的工作 | 必须落地的证据 |
|---|---|---|
| 需求拆解 | 整理 P0/P1/P2、演示路径、技术边界 | `docs/requirements_and_architecture.md`、`docs/development_schedule.md` |
| 节点 spec | 把每个节点变成可执行验收标准 | `docs/2026-05-30-node1-spec.md`、`docs/2026-06-03-node2-spec.md`、`docs/2026-06-06-node3-spec.md`、`docs/2026-06-10-node4-spec.md` |
| 代码实现 | 生成或修改 Fastify、React、Socket.IO、Redis、MySQL 相关代码 | `apps/**`、`packages/**`、`infra/mysql/init/001_create_schema.sql` |
| 测试补充 | 增加 HTTP、WebSocket、并发、E2E 断言 | `apps/api/src/test/api.integration.test.ts`、`apps/web/src/test/live-room.e2e.ts`、`docs/2026-06-06-node3-test-supplement-spec.md` |
| 并发验证 | 编写和扩展并发脚本模式 | `apps/api/src/scripts/simulate-concurrency.ts`、`docs/concurrency_demo.md` |
| 节点 4 文档 | 整理演示脚本、答辩说明、最终验收清单、AI 使用说明 | `docs/2026-06-10-demo-script.md`、`docs/2026-06-10-technical-defense.md`、`docs/2026-06-10-final-acceptance-checklist.md`、本文 |

## 3. 人工把控和本轮协作记录

已可确认的把控点：

| 把控点 | 记录 |
|---|---|
| 范围冻结 | 本轮以 `docs/2026-06-10-node4-spec.md` 为节点 4 总控标准。 |
| 写入边界 | 修改 agent 的任务边界被限制在 `docs/`，暂时不修改 `apps`、`packages`、`infra`、`scripts` 或 `package.json`。 |
| 并行协作 | 主 agent 并行验证命令；修改 agent 不能回滚或覆盖别人改动。 |
| 虚假交付控制 | 本轮文档要求不要写“未来计划”冒充已完成能力，不要声称未发生的人工作业。 |
| 审批机制 | 用户要求后续审批 agent 审核，审批规则见 `docs/2026-06-10-node4-spec.md`。 |
| 密钥约束 | 节点 4 spec 要求检查仓库不含真实 API Key，`.env` 不被提交。 |

当前尚不能声称的事项：

- 不能声称录屏视频文件已经产出。
- 不能声称所有代码都经过人工逐行审查。

## 4. 追溯矩阵

| 问题 | 追溯入口 | 复验证据 |
|---|---|---|
| 节点 4 范围是什么？ | `docs/2026-06-10-node4-spec.md` | P0 任务 1-6、禁止新增范围、审批规则 |
| 项目为什么不接真实直播流？ | `docs/requirements_and_architecture.md`、`docs/development_schedule.md` | 固定视频模拟直播，真实直播流是非 P0 |
| 页面路径是否真实存在？ | `apps/web/src/App.tsx` | `/admin/auctions/new`、`/admin/auctions`、`/admin/orders`、`/live/:roomId`、`/me/orders`、`/pay/:orderId` |
| API 路径是否真实存在？ | `apps/api/src/routes/*` | `/api/products`、`/api/auctions`、`/api/auctions/:id/start`、`/api/auctions/:id/cancel`、`/api/auctions/:id/bids`、`/api/orders/:id/mock-pay` |
| 状态机是否和代码一致？ | `packages/shared/src/auction-status.ts` | `Draft`、`Scheduled`、`Running`、`Sold`、`Passed`、`Canceled` |
| WebSocket 事件是否一致？ | `docs/websocket_event_protocol.md`、`packages/shared/src/realtime-types.ts` | `room.join`、`auction.subscribe`、`bid.accepted`、`auction.extended`、`order.paid` 等 |
| 数据库表和约束是什么？ | `infra/mysql/init/001_create_schema.sql` | 7 张核心表、`uniq_bids_request`、`uniq_orders_auction` |
| 并发脚本是否支持四种模式？ | `apps/api/src/scripts/simulate-concurrency.ts`、根 `package.json` | `--mode=unique|duplicate-accepted|duplicate-rejected|lock-busy`，根脚本参数透传 `--` |
| 测试是否覆盖核心风险？ | `apps/api/src/test/api.integration.test.ts`、`apps/web/src/test/live-room.e2e.ts` | HTTP、WebSocket、Redis 幂等、终态、双页面实时和支付 |
| 最终验收怎么判定？ | `docs/2026-06-10-final-acceptance-checklist.md` | 命令、浏览器路径、MySQL 证据、并发模式、密钥扫描 |

## 5. AI 生成内容的审查口径

AI 生成或修改内容后，必须按下面口径复核：

| 类别 | 审查问题 | 通过标准 |
|---|---|---|
| Spec | 是否清楚写了范围、非目标、命令、验收标准？ | 能指导另一个 agent 或人独立复验 |
| 代码 | 是否和现有架构一致？是否引入大改？ | 保持 Fastify/React/Socket.IO/Redis/MySQL 现有分层 |
| 测试 | 是否只测 happy path？是否有负例和隔离？ | 有拒绝出价、重复请求、终态、WebSocket 隔离、并发模式 |
| 文档 | 是否写了不存在能力？路径和命令是否真实？ | 路径、事件、状态、脚本命名能在代码中找到 |
| 密钥 | 是否出现真实 key/token/password？ | 只允许示例占位；真实密钥不得进入 repo |
| 审批修改 | 是否只处理审批 agent 指出的问题？ | 每轮列出改了哪些文件、为什么改、如何验证 |

## 6. 审批修改追溯规则

审批 agent 会输出：

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

修改 agent 的处理规则：

- 只处理审批 agent 明确指出的问题。
- 不扩展节点 4 边界。
- 不回滚或覆盖并行 agent/用户改动。
- 如果只改文档，不修改代码和脚本。
- 修改后在最终回复列出新增/修改文件、修改原因、验证方式和未验证原因。

审批 agent 已在第二轮复验中给出“审批结论：通过，P0 阻塞项：无”。这只代表节点 4 文档和验收证据通过审批，不代表录屏视频已经产出，也不代表所有代码都经过人工逐行审查。

## 7. 可用于答辩的一分钟表述

本项目使用 AI 辅助把直播竞拍课题拆成节点 spec、工程实现、测试和最终演示材料。AI 不是最终可信来源，最终可信来源是仓库文件、测试命令、浏览器路径、MySQL 行数和审批复验。人工把控主要集中在范围冻结、技术取舍、真实密钥不入库、录屏和提交确认上：真实直播流、真实支付、复杂鉴权和大规模压测没有被包装成已完成能力。节点 4 的目标是冻结可提交版本，所以本轮补齐了演示脚本、技术答辩、验收清单和 AI 使用说明，并由审批 agent 复验到 P0 阻塞项为空。
