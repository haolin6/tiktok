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

## 代码贡献率口径

AI 辅助了大部分代码草拟、测试设计和文档整理，估算参与度约 70%-85%。关键业务决策、范围取舍、验收口径、失败修复和最终通过判定由人工把控。

## 最终证据链

- 源码：`apps/web/src/App.tsx`、`apps/api/src/services/auctions-service.ts`、`apps/api/src/realtime/realtime-hub.ts`。
- 测试：`apps/api/src/test/api.integration.test.ts`、`apps/web/src/test/live-room.e2e.ts`。
- 脚本：`apps/api/src/scripts/simulate-concurrency.ts`、`apps/api/src/scripts/simulate-realtime-fanout.ts`。
- 文档：`docs/final_acceptance_log.md`、`docs/performance_evidence.md`、`docs/websocket_event_protocol.md`。
- 验收命令：`npm run build`、`npm run test`、`npm run test:e2e`、四种 `demo:concurrency`、`demo:realtime-fanout`。
