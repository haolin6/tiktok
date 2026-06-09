# 2026-06-10 节点 4 演示脚本

本脚本用于 10-15 分钟录屏或现场演示。默认本地 Web 地址为 `http://127.0.0.1:3000`，API 地址为 `http://127.0.0.1:4000`。演示目标是证明：

```text
后台发布竞拍 -> 用户进入直播间 -> 双端实时出价 -> 自动延时/成交/取消 -> 订单生成 -> 模拟支付 -> 后台和用户端可查看结果 -> 并发一致性可解释
```

## 0. 演示前准备

演示身份：

| 身份 | 使用方式 | 页面/接口 |
|---|---|---|
| 主播/后台 | 管理端创建、开始、查看竞拍和订单 | `/admin/auctions/new`、`/admin/auctions`、`/admin/orders` |
| 用户 A | 直播间用户选择器中的 `竞拍用户 A` | `/live/:roomId` |
| 用户 B | 第二个浏览器窗口中选择 `竞拍用户 B` | `/live/:roomId` |
| 用户 C | 备用用户，用于说明第三个竞拍者或订单历史 | `/live/:roomId`、`/me/orders` |

启动和检查：

```bash
npm run check:env
npm run redis:ping
npm run db:mysql:ping
npm run db:migrate
npm run db:seed
npm run dev
```

成功看什么：

- `npm run redis:ping` 返回 `PONG`。
- `npm run db:mysql:ping` 返回 `mysqld is alive`。
- `npm run dev` 后 API 和 Web 均启动，Web 可打开 `http://127.0.0.1:3000/admin/auctions`。
- `/api/demo/context` 已能提供 `Demo 直播间` 和 `竞拍用户 A/B/C`。

备用路线：

- 如果 `npm run dev` 输出端口占用，先停止旧服务，或说明使用当前已经启动的服务继续录屏。
- 如果 seed 数据缺失，重新执行 `npm run db:seed`。
- 如果浏览器缓存导致旧页面，使用无痕窗口或刷新页面。

录屏片段建议：保留 10-20 秒终端检查画面，证明不是只展示静态页面。

## 1. 业务场景和目标，约 30 秒

页面路径：`/admin/auctions`

操作：

1. 打开管理端竞拍列表。
2. 口头说明这是直播电商固定视频模拟场景，不接真实直播流和真实支付。
3. 说明本轮演示只证明 P0 主链路和并发一致性。

预期现象：

- 页面顶部有 `竞拍`、`发布`、`订单`、`我的` 导航。
- 列表展示已有竞拍或空状态。

备用路线：

- 如果列表为空，直接进入 `/admin/auctions/new` 创建新竞拍。
- 如果页面报 API 错误，切到终端展示 API 服务状态和 `/health` 或环境检查结果。

录屏片段建议：保留导航和列表区域，作为全链路起点。

## 2. 后台发布竞拍，约 2 分钟

页面路径：`/admin/auctions/new`

操作：

1. 打开发布页。
2. 填写或保留默认字段：
   - 商品标题：例如 `节点4演示商品`。
   - 商品图片：保留默认图片 URL 或填写可访问图片。
   - 商品介绍：简短说明演示商品。
   - 起拍价：`99`。
   - 加价幅度：`10`。
   - 封顶价：建议 `129`，便于三次有效出价内成交。
   - 时长秒：建议 `30`，便于展示倒计时和自动延时。
3. 点击 `创建并开始`。
4. 记录页面返回的竞拍 ID 和 `进入直播间` 链接。

预期现象：

- 页面显示 `竞拍 #<auctionId>`。
- 状态为 `Running`。
- 出现 `进入直播间` 和 `订单列表` 链接。

备用路线：

- 如果创建失败，查看页面错误信息；常见原因是 MySQL/Redis 或 demo room 未准备好。
- 如果 `创建并开始` 失败但 `创建` 成功，进入 `/admin/auctions` 点击该竞拍行的 `开始`。
- 如果需要证明取消能力，使用 API 备用路线：

```bash
curl -s -X POST http://127.0.0.1:4000/api/auctions/<auctionId>/cancel \
  -H 'content-type: application/json' \
  -d '{"reason":"demo cancel"}'
```

取消能力当前通过 API、MySQL 和 `auction.canceled` 实时事件验收；前端管理端没有独立取消按钮，不在演示中冒充页面能力。

录屏片段建议：完整录下表单、`创建并开始`、返回竞拍 ID。

## 3. 两个用户进入直播间，约 1 分钟

页面路径：`/live/:roomId`

操作：

1. 从创建结果点击 `进入直播间`。
2. 复制同一个 `/live/<roomId>` 到第二个浏览器窗口。
3. 第一个窗口选择 `竞拍用户 A`。
4. 第二个窗口选择 `竞拍用户 B`。

预期现象：

- 两个窗口都显示固定视频背景、商品卡片、当前价、下一口价、倒计时、领先者、最近出价、排行榜。
- 连接状态显示 `connected`。
- 在线人数随进入窗口增加。

备用路线：

- 如果 WebSocket 连接短暂断开，页面会按重连策略重新 `room.join`、`auction.subscribe` 并获取 `auction.snapshot`。
- 如果实时事件现场不稳定，刷新页面后展示最新快照；快照来自 MySQL 支撑的 `/api/auctions/:id/snapshot`。

录屏片段建议：左右并排展示两个浏览器窗口，保留连接状态、当前价和倒计时。

## 4. 用户 A/B 交替出价并观察实时同步，约 2 分钟

页面路径：两个 `/live/:roomId` 窗口

操作：

1. 用户 A 点击 `出价 ¥<nextBidAmount>`。
2. 观察用户 B 窗口价格、领先者、最近出价、排行榜同步变化。
3. 用户 B 再点击出价。
4. 观察用户 A 窗口出现新的价格和领先者。

预期现象：

- 成功出价方出现 `出价成功` 提示。
- 另一个窗口无需手动刷新即可看到当前价变化。
- `最近出价` 和 `排行榜` 更新。
- 非法或过期出价会显示错误，不会改变当前价。

备用路线：

- 如果某个窗口没有及时收到广播，刷新该窗口，展示最新 `auction.snapshot` 与另一窗口一致。
- 如果按钮不可点，检查竞拍状态是否已经 `Sold`、`Passed` 或 `Canceled`；终态不能再出价属于正确行为。

录屏片段建议：重点拍下 A 出价后 B 立刻变化、B 出价后 A 立刻变化。

## 5. 触发自动延时，约 1 分钟

页面路径：两个 `/live/:roomId` 窗口

操作：

1. 等倒计时进入最后 10 秒附近。
2. 用户 A 或用户 B 点击下一口价。
3. 观察倒计时/结束时间变化。

预期现象：

- 页面出现 `已自动延时到 ...` 提示。
- 两个窗口都收到 `auction.extended` 后的最新快照。
- MySQL `auction_events` 中能查到 `auction.extended`。

备用路线：

- 如果现场倒计时没卡准，不强行反复等待；切到已保存或重新跑的测试证据，展示 `auction.extended` 事件行。
- 如果竞拍已达到封顶价并成交，说明封顶成交优先于延时，是合法业务规则。

录屏片段建议：录下最后 10 秒附近出价和延时提示。

## 6. 成交、订单生成和模拟支付，约 2 分钟

页面路径：`/live/:roomId`、`/pay/:orderId`

操作：

1. 继续出价直到达到封顶价，或等待倒计时结束。
2. 成交后，在赢家窗口点击 `去支付`。
3. 在 `/pay/<orderId>` 点击 `模拟支付`。

预期现象：

- 直播间显示 `成交` 和成交金额。
- 赢家看到 `去支付` 链接，非赢家显示 `未成交`。
- 支付页展示商品、成交价、买家、状态。
- 点击 `模拟支付` 后订单状态变成 `paid`，直播间可收到 `订单 #<id> 已支付` 提示。

备用路线：

- 如果倒计时结束后页面未自动变更，刷新直播间或请求 `/api/auctions/<auctionId>/snapshot`；快照接口会触发到期结算检查。
- 如果支付页打不开，从 `/admin/orders` 找到订单并点击对应 `支付页`。

录屏片段建议：录下成交结果、跳转支付页、支付状态从 `pending_payment` 变为 `paid`。

## 7. 后台和用户端查看结果，约 1 分钟

页面路径：`/admin/orders`、`/me/orders`

操作：

1. 打开 `/admin/orders`。
2. 找到刚生成的订单。
3. 打开 `/me/orders`，选择赢家用户。
4. 查看 `我的订单` 和 `我的出价`。

预期现象：

- 后台订单列表能看到订单 ID、商品、买家、金额、状态和支付页入口。
- 用户端订单历史能看到该用户的订单。
- 用户端出价历史显示成功或失败原因。

备用路线：

- 如果列表未及时刷新，点击刷新或重新打开页面。
- 如果不知道赢家是谁，回到直播间查看成交面板，或用 SQL 查 `orders.buyer_id`。

录屏片段建议：后台订单和用户订单历史各保留 10-20 秒。

## 8. 运行四种并发演示，约 2 分钟

终端路径：项目根目录 `/Users/haolin6/Documents/tiktok`

操作：

```bash
npm run demo:concurrency -- --mode=unique
npm run demo:concurrency -- --mode=duplicate-accepted
npm run demo:concurrency -- --mode=duplicate-rejected
npm run demo:concurrency -- --mode=lock-busy
```

预期现象：

- 每条输出包含 `mode`、`auctionId`、`attempts`、`accepted`、`rejected`、`duplicate`、`lockBusy`、`businessRejected`、`orderCount`、`acceptedBidRows`、`rejectedBidRows`、`acceptedEventRows`、`rejectedEventRows`、`eventCounts`。
- `unique`：100 个用户同抢一口价，只接受 1 个有效出价，`orderCount=1`。
- `duplicate-accepted`：重复成功请求只复用第一次结果，不新增 bid/event。
- `duplicate-rejected`：重复失败请求只复用第一次拒绝，不新增 rejected bid/event。
- `lock-busy`：人为占住 Redis lock 时出现 lock busy 拒绝，释放后新请求可成功。

备用路线：

- 如果现场并发命令受环境影响失败，展示 `docs/concurrency_demo.md` 中已保存的并发输出，再说明本次失败是环境问题、测试问题还是业务回归。
- 如果输出里缺少 `mode=<mode>`，不能认定该模式被真实执行，需要先检查根 `package.json` 的 `demo:concurrency` 是否包含参数透传 `--`。

录屏片段建议：每种模式至少保留命令和关键统计行；可以把四段终端输出连录。

## 9. MySQL 证据抽查，约 1 分钟

终端路径：项目根目录或 MySQL CLI

把并发输出中的 `<auctionId>` 代入：

```sql
SELECT
  a.id,
  a.status,
  a.current_price,
  a.current_winner_id,
  COUNT(DISTINCT o.id) AS order_count,
  SUM(CASE WHEN b.accepted THEN 1 ELSE 0 END) AS accepted_bids,
  SUM(CASE WHEN NOT b.accepted THEN 1 ELSE 0 END) AS rejected_bids,
  SUM(CASE WHEN b.reject_reason = 'lock_busy' THEN 1 ELSE 0 END) AS lock_busy_bids
FROM auctions a
LEFT JOIN orders o ON o.auction_id = a.id
LEFT JOIN bids b ON b.auction_id = a.id
WHERE a.id = <auctionId>
GROUP BY a.id, a.status, a.current_price, a.current_winner_id;
```

```sql
SELECT event_type, COUNT(*) AS event_count
FROM auction_events
WHERE auction_id = <auctionId>
GROUP BY event_type
ORDER BY event_type;
```

预期现象：

- `order_count` 与脚本输出 `orderCount` 一致。
- accepted/rejected/lock busy 行数与脚本输出一致。
- 事件表能看到 `bid.accepted`、`bid.rejected`，成交模式能看到 `auction.sold`、`order.created`。

备用路线：

- 如果没有 MySQL CLI 画面，就展示并发脚本已经打印的 `acceptedBidRows`、`rejectedBidRows`、`lockBusyBidRows`、`eventCounts`。

录屏片段建议：只录 1 个代表性 `unique` 结果和 1 个事件统计即可，不要把时间耗在 SQL 上。

## 10. 技术答辩收束，约 2 分钟

页面/文档路径：

- `docs/2026-06-10-technical-defense.md`
- `docs/websocket_event_protocol.md`
- `docs/2026-06-10-ai-usage-and-review.md`

操作：

1. 展示架构图：Web、API、Socket.IO、Redis、MySQL、并发脚本的关系。
2. 展示状态机：`Draft`、`Scheduled`、`Running`、`Sold`、`Passed`、`Canceled`。
3. 讲三层一致性：Redis lock、Redis 幂等 key、MySQL 唯一约束和事务。
4. 讲 AI 使用和人工把控：spec、代码、测试、审批修改都能追溯到文件和命令。

预期现象：

- 能在 2 分钟内说明为什么不会重复成交、不会重复支付、不会跨房间串消息。
- 不把真实直播流、真实支付、复杂鉴权、千级压测说成已完成能力。

备用路线：

- 如果现场不适合打开源码，直接展示技术答辩文档中的 Mermaid 图和问答表。

录屏片段建议：用文档画面收尾，明确本项目的工程边界和验收证据。

## 录屏素材清单

| 片段 | 建议时长 | 必须出现的画面 |
|---|---:|---|
| 环境启动和检查 | 20-40 秒 | `check:env`、Redis/MySQL ping、`npm run dev` |
| 后台发布竞拍 | 1-2 分钟 | `/admin/auctions/new` 表单、竞拍 ID、`Running` 状态 |
| 双端实时出价 | 2-3 分钟 | 两个 `/live/:roomId` 窗口、A/B 交替出价、价格和排行榜同步 |
| 自动延时或成交 | 1-2 分钟 | `auction.extended` 提示或成交面板 |
| 订单和支付 | 1-2 分钟 | `/pay/:orderId`、`模拟支付`、`paid` |
| 后台/用户结果 | 1 分钟 | `/admin/orders`、`/me/orders` |
| 并发一致性 | 2 分钟 | 四种 `demo:concurrency` 模式输出 |
| 技术说明 | 2 分钟 | 架构图、状态机图、AI 使用记录 |

## 失败判定和兜底标准

- 页面路径打不开：先判断服务未启动、端口冲突还是 API 报错；不能跳过说明。
- 实时事件不稳定：刷新页面展示 snapshot，并用 MySQL/事件表证明服务端状态正确。
- 并发输出不符合模式预期：按业务回归处理，不能用旧截图替代最终验收。
- 密钥扫描命中：区分示例占位字段和真实凭据；真实凭据必须移出仓库后再提交。
