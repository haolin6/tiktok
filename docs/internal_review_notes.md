# 内测和评审记录

日期：2026-06-10

## 内测路径

本次内测基于本地环境完成，不虚构外部用户调研。

1. 后台进入 `/admin/auctions/new`，创建商品和竞拍规则。
2. 在发布页填写自动延时参数：延时触发阈值秒、每次延长秒数。
3. 后台进入 `/admin/auctions`，对 `Scheduled` 竞拍进入编辑页并修改规则。
4. 双用户进入 `/live/:roomId?auctionId=<id>`，A 出价后 B 出价。
5. A 页面收到 `user.outbid` 被超越提示。
6. 结束前出价触发自动延时提示。
7. 封顶成交后生成订单，赢家进入 `/pay/:orderId` 模拟支付。
8. 创建无出价竞拍并到期，直播间展示“竞拍已流拍，无人成交”且无支付入口。
9. 运行四种 `demo:concurrency`，验证并发一致性。
10. 运行 `demo:realtime-fanout -- --clients=100/200`，验证本机广播 fanout。

## 发现问题和修补

| 问题 | 修补结果 | 证据 |
|---|---|---|
| `user.outbid` 已在协议中声明但未端到端实现 | 服务端定向向 `user:{previousWinnerId}` 发事件，前端展示被超越提示 | `npm run test`、`npm run test:e2e` |
| 后端支持 `auction.passed`，前端缺少明确流拍结果 | 直播间监听并展示“竞拍已流拍，无人成交”，不显示支付入口 | `npm run test:e2e` |
| 发布页没有暴露自动延时参数 | 发布页新增两个输入，创建后 API 持久化 | `npm run test:e2e` |
| 未开始竞拍规则不可编辑 | 新增 `PATCH /api/auctions/:id` 和 `/admin/auctions/:id/edit` | `npm run test`、`npm run test:e2e` |
| E2E 曾被旧端口占用阻断 | 清理旧 3000/4000 dev server 后重跑通过 | `docs/final_acceptance_log.md` |
| 缺少 WebSocket fanout 证明 | 新增 100/200 本机 fanout 脚本和证据文档 | `docs/performance_evidence.md` |

## 剩余边界

- 线上 Demo 未部署。
- 飞书演示视频外部访问权限尚待用户确认，备用公开链接缺失。
- 真实图片文件上传未实现，当前使用商品图片 URL。
- 1000+ 在线未做线上级压测。
- 真实直播、真实支付、复杂鉴权、网关、限流和监控未进入当前版本。
- 业务运行时未接入大模型 API。
