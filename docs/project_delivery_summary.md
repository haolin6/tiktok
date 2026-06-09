# 项目交付总结

## 项目定位

实时竞拍大师是一个面向抖音电商直播场景的实时竞拍全栈系统。当前版本完成了后台发布竞拍、用户直播间出价、WebSocket 实时同步、成交订单、模拟支付、管理端取消和并发一致性验证。

直播画面使用本地固定素材模拟，业务重点放在竞拍状态机、房间级实时同步、订单闭环和高并发出价一致性。

## 提交信息

| 项目 | 内容 |
|---|---|
| 课题名称 | 实时竞拍大师：抖音电商直播竞拍全栈系统 |
| 团队形式 | 个人完成 |
| 成员 | 刘浩霖 |
| 学校 | 西安交通大学 |
| 专业 | 电子信息 |
| 角色 | 负责人 |
| 分工说明 | 刘浩霖独立完成需求拆解、前端页面、后端 API、WebSocket 实时同步、MySQL/Redis 一致性、测试、文档和演示材料 |
| 源代码仓库 | https://github.com/haolin6/tiktok |
| 演示视频 | https://uiva4ant5li.feishu.cn/minutes/obcn5b4bltgakd4sy96opf9g?from=list_page |
| 在线 Demo | 未部署线上 Demo；通过本地运行说明和演示视频替代 |

## 节点交付时间线

| 时间 | 节点 | 已完成内容 | 主要证据 |
|---|---|---|---|
| 2026-05-30 | 节点 1：项目骨架和数据模型 | npm workspaces、Fastify API、MySQL schema、商品/竞拍基础 API、环境检查脚本 | `packages/shared`、`apps/api`、`infra/mysql/init/001_create_schema.sql`、`scripts/check-env.mjs` |
| 2026-06-03 | 节点 2：业务主链路 | 后台创建竞拍、用户出价、自动成交/流拍、订单生成、模拟支付、后台/用户订单页面 | `/admin/auctions/new`、`/live/:roomId`、`/pay/:orderId`、`/admin/orders`、`/me/orders` |
| 2026-06-06 | 节点 3：实时和并发能力 | Socket.IO 房间隔离、重连后 snapshot 恢复、Redis lock、Redis 幂等 key、四种并发脚本模式、API/E2E 测试 | `apps/api/src/realtime/realtime-hub.ts`、`apps/api/src/services/bid-coordinator.ts`、`apps/api/src/scripts/simulate-concurrency.ts`、`apps/web/src/test/live-room.e2e.ts` |
| 2026-06-09 | 最终补齐 | 根 README、管理端取消按钮、三分钟演示视频脚本、直播间展示图替换、GitHub 上传 | `README.md`、`apps/web/src/App.tsx`、`docs/demo_video_script.md`、`apps/web/public/demo/live-room-audience.png`、`https://github.com/haolin6/tiktok` |

## 已完成能力

- 后台发布竞拍：创建商品、设置起拍价、加价幅度、竞拍时长、封顶价和自动延时参数。
- 后台竞拍管理：查看竞拍列表，启动竞拍，取消 `Scheduled` 或 `Running` 状态竞拍。
- 用户直播间：展示直播间素材、竞拍商品、当前价、下一口价、倒计时、领先者、最近出价和排行榜。
- 实时同步：通过 Socket.IO 广播 `auction.snapshot`、`bid.accepted`、`bid.rejected`、`ranking.updated`、`auction.extended`、`auction.sold`、`auction.canceled`、`order.paid`。
- 状态机：支持 `Draft`、`Scheduled`、`Running`、`Sold`、`Passed`、`Canceled` 六个状态。
- 成交订单：封顶成交或到期成交后生成订单，赢家进入模拟支付页，后台和用户端均可查看订单。
- 并发一致性：Redis lock 控制关键区，Redis 幂等 key 处理重复请求，MySQL 事务和唯一约束兜底。
- 测试覆盖：Vitest 覆盖 shared 类型和 API 集成链路，Playwright 覆盖用户端双页面同步和管理端取消。

## AI 使用说明

本项目的 AI 使用重点是全栈开发协作，而不是在竞拍业务链路中强行接入模型。实际开发采用 spec-first 流程：先用 AI 辅助拆解任务和风险，再把每个节点写成可实现、可验收的工程说明，最后用代码、测试、页面和数据库证据复核交付结果。

AI 参与了以下环节：

- 需求拆解：从宣讲版课题中提取主链路、实时同步、并发一致性、演示材料和非目标边界。
- 架构设计：比较前后端、实时通信、Redis/MySQL 分工，形成 React/Vite + Fastify + Socket.IO + Redis + MySQL 的方案。
- 节点实施：按 2026-05-30、2026-06-03、2026-06-06、2026-06-09 四个节点推进，避免一次性生成失控的大工程。
- 代码实现辅助：协助完成页面、API、服务层、共享类型、数据库脚本、并发脚本和测试代码。
- 测试补强：把“主链路跑通”继续拆到出价拒绝、重复请求、终态、房间隔离、Redis 幂等、MySQL 唯一约束和 E2E 同步。
- 文档交付：把实现过程收敛成 README、三分钟演示脚本、技术答辩和交付总结。

AI 协作方式：

- Prompt 先描述目标、现有代码位置、允许修改范围、接口边界和验收命令。
- 实现后用 `npm run build`、`npm run test`、Playwright E2E、并发脚本和 MySQL 行数证据复核。
- 文档按“已完成能力”和“版本边界”分开呈现：已完成主链路、实时同步、模拟支付和并发一致性；真实直播、真实支付、线上千级压测和业务大模型调用列为当前边界。

系统位置：

- AI 位于开发和交付流程中，不在用户出价、竞拍结算、订单支付或 WebSocket 同步的运行时链路中。
- `.env.example` 中的 `ARK_MODEL`、`ARK_ENDPOINT_ID`、`ARK_API_KEY` 是预留配置，当前版本没有调用 Doubao/火山方舟模型服务。

## 验收状态

上传 GitHub 前完成的检查：

```bash
npm run build
npm run test
```

结果：

- `npm run build` 通过，shared、api、web 均完成 TypeScript/Vite 构建。
- `npm run test` 通过，shared 5 个测试、API 12 个集成测试全部通过。
- `npm run test:e2e` 在上传前重跑时被本机已有 `3000` 服务占用阻断；管理端取消按钮实现后已通过 Playwright E2E 验收。
- 密钥扫描未发现真实 `ark-...`、GitHub token 或个人凭据；`.env` 未进入仓库。
- GitHub 仓库已上传到 `https://github.com/haolin6/tiktok`。

## 当前边界

当前版本未接入以下能力：

- 真实直播推流。
- 真实支付、物流和退款。
- 完整登录鉴权、多角色权限和接口网关。
- 复杂 BI 数据看板。
- 线上千级或 1000+ 用户压测。
- 独立 `/admin/auctions/:id` 详情页。

这些内容不属于当前提交版本的已完成能力。
