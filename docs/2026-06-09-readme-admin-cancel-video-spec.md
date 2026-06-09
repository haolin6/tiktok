# 2026-06-09 提交材料补齐 Spec：README + 管理端取消按钮 + 3 分钟演示视频

## 1. 目标

本轮只补齐最终提交材料中的三个明确缺口：

1. 根目录新增 `README.md`，让评委能从仓库首页理解项目、运行项目、复验项目。
2. 管理端竞拍列表新增取消按钮，把已有后端取消能力变成页面可演示能力。
3. 新增 3 分钟演示视频脚本，压缩当前 10-15 分钟演示脚本，指导录屏时展示最重要证据。

本轮不新增业务范围，不把未实现能力包装成已完成能力。

## 2. 当前真实状态

- 根目录当前没有 `README.md`。
- 后端已存在取消接口：`POST /api/auctions/:id/cancel`。
- 取消请求体为 `{ "reason": "..." }`，返回 `CancelAuctionResponse`。
- 后端取消状态机已存在，只允许合法状态流转到 `Canceled`，终态不能再取消。
- `auction.canceled` 事件已由后端广播，并且已有 API/Socket.IO 集成测试覆盖 payload 和 MySQL `auction_events` 一致性。
- 管理端 `/admin/auctions` 当前只有 `开始`、`直播间`、`Demo`，没有页面取消按钮。
- 当前已有 `docs/2026-06-10-demo-script.md`，但它是 10-15 分钟演示脚本，不适合直接作为 3 分钟公开视频脚本。

## 3. 修改边界

允许修改：

- `README.md`
- `apps/web/src/App.tsx`
- `apps/web/src/styles.css`
- `apps/web/src/test/live-room.e2e.ts`
- `docs/2026-06-09-three-minute-demo-video-script.md`
- 本 spec 文件

禁止修改：

- `apps/api/**`
- `packages/shared/**`
- `infra/mysql/**`
- `scripts/**`
- `package.json`
- `playwright.config.ts`
- 现有 HTML PPT 输出目录

如发现必须修改禁止范围内文件才能完成目标，需要先停止并说明原因，不自动扩大范围。

## 4. README.md 要求

根目录 `README.md` 必须包含：

- 项目简介和一句话定位。
- 当前已完成能力：
  - 后台发布竞拍。
  - 用户直播间出价。
  - WebSocket 实时同步。
  - 自动延时、成交、取消。
  - 订单生成、模拟支付。
  - Redis + MySQL 并发一致性验证。
- 技术栈：
  - React + Vite + TypeScript。
  - Fastify + Socket.IO。
  - MySQL + Redis。
  - Vitest + Playwright。
- 本地运行步骤：
  - `cp .env.example .env`
  - `npm install`
  - `npm run db:migrate`
  - `npm run db:seed`
  - `npm run dev`
- 页面入口：
  - `/admin/auctions/new`
  - `/admin/auctions`
  - `/live/:roomId`
  - `/pay/:orderId`
  - `/admin/orders`
  - `/me/orders`
- 验收命令：
  - `npm run check:env`
  - `npm run test`
  - `npm run build`
  - `npm run test:e2e`
  - 四种 `npm run demo:concurrency -- --mode=...`
- 当前未实现边界：
  - 固定视频模拟直播，不做真实直播推流。
  - 模拟支付，不做真实支付。
  - 不包含完整登录鉴权、复杂看板、线上千级压测。
- 安全说明：
  - `.env` 不提交。
  - `.env.example` 只保留占位配置。

README 不得声称在线 Demo、公开演示视频、远端仓库 commit 已经存在。

## 5. 管理端取消按钮要求

实现位置：`apps/web/src/App.tsx` 的 `AdminAuctionsPage`。

行为：

- 为非终态竞拍显示 `取消` 按钮。
- 终态 `Sold`、`Passed`、`Canceled` 不显示取消按钮。
- 点击取消时弹出 `window.prompt`，默认原因为 `管理端取消`。
- 用户关闭 prompt 时不发请求。
- 输入空白原因时显示错误，不发请求。
- 合法原因调用：

```text
POST /api/auctions/:id/cancel
body: { "reason": "<trimmed reason>" }
```

- 成功后重新加载竞拍列表，页面状态变为 `已取消`。
- 失败时显示后端错误。
- 取消按钮复用现有 `busyId`，请求中禁用。

样式：

- 只在 `apps/web/src/styles.css` 增加一个轻量 `.danger-button`。
- 不改变 `.auctions-grid` 列结构。
- 不重构管理端表格。

## 6. E2E 回归要求

在 `apps/web/src/test/live-room.e2e.ts` 增加一条小范围 Playwright 回归：

- 通过 API 创建并启动一个 Running auction。
- 打开 `/admin/auctions`。
- 找到对应 `#<auctionId>` 行。
- 点击该行 `取消` 按钮。
- 处理 prompt，填入 `e2e admin cancel`。
- 断言该行状态变为 `已取消`。
- 通过 API 重新查询 `/api/auctions`，确认该竞拍状态为 `Canceled`。

本 E2E 只验证管理端页面按钮真实调用取消 API，不替代已有 API/Socket.IO 取消 payload 测试。

## 7. 3 分钟演示视频脚本要求

新增 `docs/2026-06-09-three-minute-demo-video-script.md`。

脚本必须控制在约 180 秒，并包含：

| 时间 | 内容 |
|---:|---|
| 0:00-0:15 | 项目一句话和边界：固定视频模拟直播，不做真实推流 |
| 0:15-0:45 | 后台 `/admin/auctions/new` 创建并开始竞拍 |
| 0:45-1:25 | 两个 `/live/:roomId` 窗口展示 A/B 实时出价同步 |
| 1:25-1:50 | `/admin/auctions` 页面取消非终态竞拍，列表或直播间显示取消结果 |
| 1:50-2:25 | 成交、订单生成、`/pay/:orderId` 模拟支付、`/admin/orders` 查看 |
| 2:25-2:50 | 并发一致性：展示 `unique` 模式关键输出 |
| 2:50-3:00 | 收束：Redis lock、Redis 幂等 key、MySQL 唯一约束 |

脚本必须明确：

- 不展示真实直播、真实支付、完整鉴权。
- 如果时间不够，并发只录 `unique` 模式；其他三种模式放 README 或文档。
- 视频不能把未实现能力说成已完成。

## 8. 验收命令

最小验收：

```bash
npm run test
npm run build
npm run test:e2e
```

人工验收：

- 根目录存在 `README.md`。
- `/admin/auctions` 对非终态竞拍显示取消按钮。
- 点击取消后列表状态变为 `已取消`。
- 终态竞拍不显示取消按钮。
- 3 分钟视频脚本文档存在，并且可照着录屏。

## 9. 完成标准

本轮完成必须同时满足：

- spec 文件已写入。
- README 已新增。
- 管理端取消按钮已实现。
- 3 分钟演示视频脚本已新增。
- E2E 增加管理端取消回归。
- 至少完成 `npm run build`，并尽力完成 `npm run test` 和 `npm run test:e2e`；如命令因本地服务、端口或沙箱限制失败，必须记录失败原因和下一步复验方式。
