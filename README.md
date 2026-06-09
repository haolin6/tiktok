# 实时竞拍大师：抖音电商直播竞拍全栈系统

这是一个面向抖音电商直播场景的实时竞拍全栈项目。系统用固定视频模拟直播间，重点实现商家发布竞拍、用户实时出价、WebSocket 同步、竞拍成交、订单生成、模拟支付和并发一致性验证。

## 提交信息

| 项目 | 内容 |
|---|---|
| 课题名称 | 实时竞拍大师：抖音电商直播竞拍全栈系统 |
| 团队形式 | 个人完成 |
| 成员 | 刘浩霖 |
| 学校 | 西安交通大学 |
| 专业 | 电子信息 |
| 角色 | 负责人 |
| 分工说明 | 负责需求拆解、前端页面、后端 API、WebSocket 实时同步、MySQL/Redis 一致性、测试、文档和演示材料 |
| 源代码仓库 | https://github.com/haolin6/tiktok |
| 演示视频 | https://uiva4ant5li.feishu.cn/minutes/obcn5b4bltgakd4sy96opf9g?from=list_page |
| 在线 Demo | 未部署线上 Demo；通过本地运行说明和演示视频替代 |

演示视频说明：当前保留飞书链接，外部评委访问权限尚需用户确认；备用公开视频链接暂缺。

## 当前已完成能力

- 后台发布竞拍：创建商品和竞拍规则，支持配置自动延时参数，支持创建后立即开始竞拍。
- 后台规则编辑：`Scheduled` 竞拍可在开始前修改起拍价、加价幅度、封顶价、时间和延时参数。
- 用户直播间出价：用户 A/B/C 可进入同一个直播间，按下一口价参与竞拍。
- WebSocket 实时同步：同步当前价、领先者、最近出价、排行榜、延时、成交、流拍、取消、支付和被超越提醒。
- 竞拍规则：支持固定加价、封顶成交、结束前自动延时、到期成交或流拍、异常取消。
- 订单链路：成交后生成订单，赢家可进入模拟支付页，后台和用户端可查看结果。
- 并发一致性：通过 Redis lock、Redis 幂等 key、MySQL 事务和唯一约束保护出价和订单唯一性。
- 本机 fanout 证明：`demo:realtime-fanout` 已验证 100/200 个 Socket.IO 客户端收到真实出价广播。

## AI 辅助全栈开发方式

本项目采用 spec-first 的 AI 协作方式完成全栈链路。开发过程先把宣讲版课题拆成节点目标，再为每个节点固定范围、接口边界、非目标和验收命令，随后按节点推进前端、后端、数据层、实时通信、测试和文档。

AI 主要参与：

- 需求拆解：将直播竞拍课题拆成主链路、实时同步、并发一致性和交付材料。
- 架构方案：围绕 React/Vite、Fastify、Socket.IO、Redis、MySQL 设计分层实现。
- 编码辅助：生成和修改页面、API、服务层、共享类型、脚本和测试。
- 测试补强：补充 HTTP、WebSocket、幂等、终态、并发和 Playwright E2E 场景。
- 文档交付：整理 README、演示脚本、技术答辩和最终交付总结。

人工把控集中在范围取舍、状态机规则、并发一致性方案、密钥安全和最终验收。AI 产物以源码、测试命令、页面路径、MySQL 证据和 GitHub 提交为最终依据。

详细证据见 `docs/ai_usage_evidence.md`。当前版本没有在业务运行链路中调用大模型 API。

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

- `/admin/auctions/new`：后台发布竞拍，含自动延时参数
- `/admin/auctions`：后台竞拍列表、启动竞拍、取消竞拍、进入编辑
- `/admin/auctions/:id/edit`：修改未开始竞拍规则
- `/live/:roomId`：用户直播间
- `/live/:roomId?auctionId=<id>`：指定竞拍的用户直播间，便于演示和 E2E 隔离
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
npm run db:mysql:ping
npm run redis:ping
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
npm run demo:realtime-fanout -- --clients=100
npm run demo:realtime-fanout -- --clients=200
```

四种模式分别验证：

- `unique`：100 个不同用户同时抢同一口价，最终只接受 1 个有效出价并生成 1 个订单。
- `duplicate-accepted`：同一个成功请求重复提交时只回放结果，不重复涨价或重复写入。
- `duplicate-rejected`：同一个失败请求重复提交时只回放拒绝结果，不重复写入拒绝记录。
- `lock-busy`：Redis lock 被占用时按 `LOCK_BUSY` 拒绝，释放后合法请求可继续成功。
- `demo:realtime-fanout`：自启动本机 API 和 Socket.IO hub，通过真实 HTTP 出价触发 100/200 客户端广播。

## 项目文档

- `docs/live_auction_project_brief.md`：宣讲版任务要求摘要
- `docs/project_delivery_summary.md`：按节点时间线整理的最终交付总结
- `docs/final_acceptance_log.md`：2026-06-10 最终验收命令和结果
- `docs/ai_usage_evidence.md`：AI 使用流程和证据
- `docs/performance_evidence.md`：并发一致性和 WebSocket fanout 证明
- `docs/internal_review_notes.md`：本地内测和修补记录
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
- 线上 Demo 部署。
- 线上千级或 1000+ 在线压测；当前只有本机 100/200 fanout 证明。
- 真实图片文件上传；当前使用商品图片 URL。
- 业务运行链路中的大模型 API、RAG 或向量库。
- 飞书演示视频外部访问权限尚待用户确认，备用公开视频链接缺失。

这些能力不属于当前提交版本的已完成范围。

## 安全说明

- `.env` 存放本地真实配置，不应提交。
- `.env.example` 只保留占位字段。
- 真实 API Key、云服务账号、数据库密码和个人 token 不进入仓库。
