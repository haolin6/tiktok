# AI 使用证据

## 定位

本项目把 AI 用在开发流程中，不把大模型接入用户出价、竞拍结算、订单支付或 WebSocket 运行时链路。竞拍结果由 Fastify 服务、Redis 幂等/锁、MySQL 事务和数据库约束决定。

## 使用位置

| 环节 | AI 辅助内容 | 人工把控 |
|---|---|---|
| 需求拆解 | 将直播竞拍课题拆成后台发布、直播间出价、实时同步、成交订单、并发一致性、演示材料 | 明确真实直播、真实支付、复杂鉴权和线上部署不是当前版本目标 |
| 方案设计 | 为开发节点编写目标、边界、测试和验收命令 | 决定实现优先级和高成本项是否进入当前版本 |
| 编码实现 | 辅助修改 React 页面、Fastify 路由、服务层、共享类型、Socket.IO hub、脚本和测试 | 校验状态机、幂等、事务和文档事实一致 |
| 测试补强 | 设计 HTTP、WebSocket、Playwright、并发脚本和负例覆盖 | 用真实命令结果判断是否通过 |
| 文档交付 | 整理 README、演示脚本、技术答辩、交付总结和最终验收日志 | 不把未完成能力写成已完成 |

## 关键 AI 指令摘要

1. 项目骨架阶段：要求基于 React/Vite、Fastify、MySQL、Redis、npm workspaces 建立直播竞拍工程骨架，并用 `/health`、MySQL schema 和环境检查脚本验收。
2. 主链路阶段：要求实现后台创建竞拍、用户出价、封顶成交、到期成交/流拍、订单生成和模拟支付，验收必须包含 HTTP 响应和 MySQL 行证据。
3. 实时与并发阶段：要求补齐 Socket.IO 房间隔离、断线恢复、Redis lock、Redis 幂等 key、MySQL 唯一约束，以及四种并发一致性脚本。
4. 测试补强阶段：要求检查测试是否过于乐观，增加拒绝出价、终态、跨房间、重复请求、锁忙和 Playwright 双页面同步。
5. 交付完善阶段：要求补齐被超越提醒、流拍展示、自动延时参数、未开始规则编辑、fanout 证明、多档出价、加价器和最终验收日志。

## AI 协作指令体系

本项目采用结构化 AI 指令来约束输出质量。每类指令都包含目标、边界、涉及文件、测试方式和验收证据，避免只停留在代码生成层面。

| 指令类型 | 核心约束 | 产出 |
|---|---|---|
| 节点方案设计 | 先阅读现有文档、代码结构、数据库 schema 和接口实现；明确目标、修改边界、非目标、测试方式和验收命令 | 节点开发方案、验收清单 |
| 按方案实现 | 优先沿用仓库现有 React/Vite、Fastify、Socket.IO、MySQL、Redis 和 npm workspaces 写法；每改一层同步测试和文档事实 | 前端、后端、实时通信、脚本和测试代码 |
| 测试审计 | 不只检查通过用例，还主动补充错误用户、错误房间、重复请求、锁忙、终态竞拍、封顶成交、到期流拍和取消后的非法出价 | API 集成测试、Playwright E2E、并发脚本 |
| 事实复核 | 检查代码、测试、页面路径、命令输出和文档是否一致；未完成能力必须写入边界，不写成已完成 | README、验收日志、答辩文档 |
| 验收解释 | 把命令结果对应到 HTTP 行为、WebSocket 事件、MySQL 数据和页面可见结果 | 最终验收日志、性能证据 |

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

## 最后阶段人工决策记录

| 决策点 | AI 辅助建议 | 人工判断 | 最终取舍 | 证据 |
|---|---|---|---|---|
| 线上 Demo | 可以补部署说明或尝试临时部署 | 临时部署会引入环境和域名风险，且不是当前本机验收链路的必要条件 | 不部署线上 Demo，用 B 站演示视频、本地运行路径和验收命令替代 | `README.md` 写明在线 Demo 未部署；`docs/final_acceptance_log.md` 记录本机验收 |
| 1000+ 在线 | 可以描述架构方向 | 没有线上压测和稳定机器证据时不能写成已完成 | 只写本机 100 并发一致性和 100/200 Socket.IO fanout 证据 | `docs/performance_evidence.md`、`npm run demo:concurrency`、`npm run demo:realtime-fanout` |
| 多档出价 | 初始评估会影响后端校验、并发语义和前端同步 | 真实竞拍任务需要用户可选择更高档金额，不能只做下一口价按钮 | 纳入最后修补，规则为步长对齐、允许自己加价、超封顶截断、封顶可作为终点例外 | `apps/api/src/services/auctions-service.ts`、`apps/web/src/App.tsx`、API/E2E 测试 |
| 加价器同步 | 可以只做视觉按钮 | 只做视觉会和真实业务规则脱节，也无法证明多档出价 | 前端提交 `selectedBidAmount`，WebSocket/snapshot 更新时保留合法高档金额或自动抬到最新下一口价 | `apps/web/src/test/live-room.e2e.ts` 的加价器与被超越用例 |
| 竞价氛围 | 可以加入大弹层和提示音 | 大弹层会遮挡继续出价，提示音受浏览器自动播放策略影响，录屏不稳定 | 采用轻量动画：领先状态、被超越 shake、最后倒计时 pulse、排名高亮；不把提示音列为必做项 | `apps/web/src/styles.css`、`prefers-reduced-motion` 降级 |

## AI 协作口径

本项目高度使用 AI 参与代码生成、测试设计、问题排查和文档整理。人工把控集中在目标拆解、指令约束、范围取舍、状态机规则、验收口径、事实修正和最终通过判定。

## 最终证据链

- 源码：`apps/web/src/App.tsx`、`apps/api/src/services/auctions-service.ts`、`apps/api/src/realtime/realtime-hub.ts`。
- 测试：`apps/api/src/test/api.integration.test.ts`、`apps/web/src/test/live-room.e2e.ts`。
- 脚本：`apps/api/src/scripts/simulate-concurrency.ts`、`apps/api/src/scripts/simulate-realtime-fanout.ts`。
- 文档：`docs/final_acceptance_log.md`、`docs/performance_evidence.md`、`docs/websocket_event_protocol.md`。
- 验收命令：`npm run build`、`npm run test`、`npm run test:e2e`、四种 `demo:concurrency`、`demo:realtime-fanout`。
