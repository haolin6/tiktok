# 实时竞拍大师：抖音电商直播竞拍全栈系统

这是一个面向抖音电商直播场景的实时竞拍全栈项目。系统用固定视频模拟直播间，重点实现商家发布竞拍、用户实时出价、WebSocket 同步、竞拍成交、订单生成、模拟支付和并发一致性验证。

## 当前已完成能力

- 后台发布竞拍：创建商品和竞拍规则，支持创建后立即开始竞拍。
- 用户直播间出价：用户 A/B/C 可进入同一个直播间，按下一口价参与竞拍。
- WebSocket 实时同步：同步当前价、领先者、最近出价、排行榜、延时、成交、取消和支付事件。
- 竞拍规则：支持固定加价、封顶成交、结束前自动延时、到期成交或流拍、异常取消。
- 订单链路：成交后生成订单，赢家可进入模拟支付页，后台和用户端可查看结果。
- 并发一致性：通过 Redis lock、Redis 幂等 key、MySQL 事务和唯一约束保护出价和订单唯一性。

## 技术栈

- 前端：React + Vite + TypeScript
- 后端：Fastify + Socket.IO + TypeScript
- 数据层：MySQL + Redis
- 测试：Vitest + Playwright
- 工程：npm workspaces

## 本地运行

环境要求：

- Node.js >= 22.17.0
- npm >= 10.9.2
- MySQL 8.0
- Redis

初始化配置：

```bash
cp .env.example .env
npm install
```

按本机 MySQL/Redis 情况修改 `.env`，然后执行：

```bash
npm run check:env
npm run db:migrate
npm run db:seed
npm run dev
```

默认本地地址：

- Web: `http://127.0.0.1:3000`
- API: `http://127.0.0.1:4000`

## 演示入口

- `/admin/auctions/new`：后台发布竞拍
- `/admin/auctions`：后台竞拍列表、启动竞拍、取消竞拍
- `/live/:roomId`：用户直播间
- `/pay/:orderId`：模拟支付
- `/admin/orders`：后台订单列表
- `/me/orders`：用户订单和出价历史

推荐演示路径：

```text
后台发布竞拍 -> 用户进入直播间 -> 双端实时出价 -> 自动延时/成交/取消 -> 订单生成 -> 模拟支付 -> 后台和用户端查看结果 -> 并发一致性说明
```

## 验收命令

基础验收：

```bash
npm run check:env
npm run test
npm run build
npm run test:e2e
```

并发一致性演示：

```bash
npm run demo:concurrency -- --mode=unique
npm run demo:concurrency -- --mode=duplicate-accepted
npm run demo:concurrency -- --mode=duplicate-rejected
npm run demo:concurrency -- --mode=lock-busy
```

四种模式分别验证：

- `unique`：100 个不同用户同时抢同一口价，最终只接受 1 个有效出价并生成 1 个订单。
- `duplicate-accepted`：同一个成功请求重复提交时只回放结果，不重复涨价或重复写入。
- `duplicate-rejected`：同一个失败请求重复提交时只回放拒绝结果，不重复写入拒绝记录。
- `lock-busy`：Redis lock 被占用时按 `LOCK_BUSY` 拒绝，释放后合法请求可继续成功。

## 项目文档

- `docs/live_auction_project_brief.md`：宣讲版任务要求摘要
- `docs/project_delivery_summary.md`：按节点时间线整理的最终交付总结
- `docs/demo_video_script.md`：三分钟成果演示视频脚本
- `docs/technical_defense.md`：技术答辩说明
- `docs/concurrency_demo.md`：并发一致性演示说明
- `docs/websocket_event_protocol.md`：WebSocket 事件协议
- `docs/environment_setup.md`：本地环境配置

## 当前边界

当前版本未接入以下能力：

- 真实直播推流：系统使用本地素材模拟直播间。
- 真实支付和物流：系统实现模拟支付。
- 完整登录鉴权、多角色权限、接口网关和限流。
- 复杂数据看板。
- 线上千级或 1000+ 在线压测。

这些能力不属于当前提交版本的已完成范围。

## 安全说明

- `.env` 存放本地真实配置，不应提交。
- `.env.example` 只保留占位字段。
- 真实 API Key、云服务账号、数据库密码和个人 token 不进入仓库。
