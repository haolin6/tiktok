# 2026-06-06 节点 3 补充测试 Spec：把实时和并发验收从“能跑”补到“抗回归”

## 1. 背景和目标

这个文件是 `docs/2026-06-06-node3-spec.md` 的补充测试 spec，不替代原 spec。

节点 3 已经完成了 Socket.IO、Redis 锁/幂等、自动延时、并发脚本和用户端实时验收。但现有测试更偏“验收型”：能证明主链路跑通，却还不能充分证明所有边界都不会回归。

本补充 spec 的目标是把 6 月 6 日节点 3 的测试补齐到下面这个标准：

- 不只测成功出价，也测错误出价、重复请求、锁忙、跨房间访问、取消和到期结算广播。
- 不只测 HTTP 返回，也测 Socket.IO 事件是否发给正确的人、是否不会发给错误的人。
- 不只测 Redis 参与并发，也测 Redis 幂等 key 的 accepted/rejected/processing 三种状态。
- 不只靠手工浏览器验收，也要有最小可重复的前端 E2E 回归。
- 每个补充测试都能回答三个问题：
  - 这个测试防什么真实风险？
  - 边界条件是什么？
  - 怎么判断已经修改好？

## 2. 修改边界

允许修改：

- `apps/api/src/test/**`
- `apps/api/src/services/**`
- `apps/api/src/realtime/**`
- `apps/api/src/scripts/**`
- `apps/web/src/**`
- `packages/shared/src/**`
- `docs/**`
- 必要时新增测试工具文件，例如 `apps/api/src/test/test-helpers.ts`

尽量不要修改：

- `infra/mysql/init/001_create_schema.sql`，除非测试发现 schema 真实缺陷。
- 生产 API 形状，除非现有实现和原 spec 冲突。

不能做：

- 为了让测试通过而放宽“下一口价必须等于当前价 + 加价幅度”的业务规则。
- 为了清理测试数据而 `TRUNCATE` 生产表。
- 让测试依赖固定 auctionId、固定 orderId 或某次历史运行结果。
- 在测试里绕过 Redis 锁/幂等路径来假装并发通过。

## 3. 测试设计原则

每个补充测试都应该同时检查至少两层证据：

- API/Socket.IO 层：HTTP status、ack、Socket.IO event。
- MySQL 层：`auctions`、`bids`、`orders`、`auction_events` 的最终状态。
- Redis 层：必要时检查 key 行为，例如 processing、accepted、rejected、lock busy。

事件类测试必须检查“收到”和“没收到”：

- 正确订阅者必须收到目标事件。
- 错误房间、错误用户或未订阅 socket 不能收到不该看到的事件。

时间类测试尽量不要真实等待：

- 通过创建 fixture 或直接更新 `end_at`，把竞拍放到“刚好进入延时阈值”“刚好超过阈值”“已经结束”的状态。
- 不用固定睡眠来赌时机。

## 4. 补充任务 T1 [P0]：取消和开始竞拍的实时广播测试

### 要防的风险

HTTP 取消或开始竞拍成功了，但订阅页面没有收到正确广播；或者广播 payload 看起来有事件，里面的状态却是错的。

当前特别要防的是 `auction.canceled.previousStatus` 被写死成 `Running`，导致取消 `Scheduled` 竞拍时实时事件和数据库事件不一致。

### 边界条件

- `Scheduled -> Canceled`
- `Running -> Canceled`
- `Sold/Passed/Canceled -> Canceled` 必须失败，且不能广播成功事件。
- `Scheduled -> Running` 开始竞拍后必须广播最新 `auction.snapshot`。
- 重复 start Running 竞拍可以保持幂等，但不能制造错误状态。

### 测试设计

在 API 集成测试中新增或拆分测试：

1. 创建商品和 `Scheduled` auction。
2. 打开 socket，执行 `room.join` 和 `auction.subscribe`。
3. 调用 `POST /api/auctions/:id/cancel`。
4. 等待 socket 收到 `auction.canceled` 和 `auction.snapshot`。
5. 断言：
   - `auction.canceled.payload.previousStatus === "Scheduled"`。
   - `auction.canceled.payload.status === "Canceled"`。
   - `auction.snapshot.payload.auction.status === "Canceled"`。
   - MySQL `auction_events` 中 `auction.canceled` 的 payload 和实时事件一致。
6. 对 Running auction 重复同样流程，断言 `previousStatus === "Running"`。
7. 对已经 Sold 的 auction 调用 cancel，断言 HTTP 409，且订阅 socket 在短时间内收不到 `auction.canceled`。

### 验收标准

- `npm run test -w @live-auction/api` 通过。
- 测试能在没有固定 auctionId 的情况下重复运行。
- `auction.canceled` 的实时 payload 与 MySQL 事件 payload 一致。
- terminal 状态取消失败时不产生新的 `auction.canceled` 广播。

## 5. 补充任务 T2 [P0]：`bid.rejected` 实时负例和污染隔离

### 要防的风险

错误出价只在 HTTP 层失败，Socket.IO 页面没有明确失败原因；或者 A 用户出错价，B 用户也被错误提示污染。

### 边界条件

- 出价金额不是下一口价。
- 竞拍已经 Sold/Passed/Canceled 后继续出价。
- socket 已 join 但未 subscribe 时是否只能收到私有失败反馈，而不是污染整个 auction room。
- `bid.place` payload 携带不一致 `userId` 时，应该 ack 失败，但不应该写 MySQL rejected bid，因为这是身份校验失败，不是业务出价失败。

### 测试设计

新增 Socket.IO 集成测试：

1. 创建 Running auction，下一口价为 109。
2. socket A 和 socket B 都 join + subscribe 同一 auction。
3. socket A 发送 `bid.place`，金额为 119。
4. 断言：
   - socket A 的 ack 为失败。
   - socket A 收到 `bid.rejected`，payload 包含 `userId=A`、`amount=119`、`requestId`、明确 reason。
   - socket B 在 300-500ms 内收不到 `bid.rejected`。
   - MySQL `bids` 有 1 条 `accepted = FALSE`。
   - MySQL `auction_events` 有 1 条 `bid.rejected`。
   - auction current_price 不变。
5. 再创建 Sold auction，socket A 出价，断言 rejected reason 指向 terminal 状态，且价格和订单不变。
6. socket A 发送 payload `{ userId: bidderBId }` 的 `bid.place`：
   - ack 失败。
   - 不写 `bids`。
   - 不写 `auction_events`。
   - 不向 socket B 发 `bid.rejected`。

### 验收标准

- 失败原因能从 Socket.IO 事件看到，而不是只有 HTTP body。
- 错误用户不会收到别人的 `bid.rejected`。
- 身份校验失败和业务拒绝分开处理：前者不落 bid，后者落 rejected bid。

## 6. 补充任务 T3 [P0]：跨直播间订阅和出价隔离

### 要防的风险

用户 join 了 room A，却能 subscribe 或 bid room B 的 auction。这个风险一旦存在，直播间之间的价格、订单和事件都会串。

### 边界条件

- join room A，subscribe room B 下的 auction。
- join room A，bid room B 下的 auction。
- room B 的真实订阅者不应该因为 room A 的非法操作收到任何事件。
- 非 active room 不能 join。

### 测试数据准备

如果当前 seed 只有一个直播间，测试中用 SQL 插入一个独立 active room：

```sql
INSERT INTO auction_rooms (demo_key, title, status)
VALUES (?, ?, 'active');
```

测试数据必须带唯一后缀，避免重复运行冲突。

### 测试设计

1. 准备 room A 和 room B。
2. 在 room B 创建 Running auction。
3. socket A join room A。
4. socket B join room B 并 subscribe room B auction，作为正确订阅者。
5. socket A 尝试 `auction.subscribe` room B auction。
6. 断言：
   - socket A ack 失败。
   - socket A 收不到 room B auction 的 `auction.snapshot`。
7. socket A 尝试 `bid.place` room B auction。
8. 断言：
   - socket A ack 失败。
   - socket B 收不到 `bid.accepted` / `auction.snapshot` 变化。
   - MySQL `bids` 对该 requestId 为 0。
   - auction current_price 不变。

### 验收标准

- 跨房间 subscribe 和 bid 都被拒绝。
- 拒绝发生在进入 `placeBid` 前，不能留下 rejected bid 行。
- 正确房间的订阅者不被非法操作打扰。

## 7. 补充任务 T4 [P0]：Redis 幂等 key 的三态测试

### 要防的风险

现在并发脚本证明了 100 个不同 requestId 同时出价不会多成交，但还没充分证明“同一个 requestId 重复请求”在 accepted、rejected、processing 三种状态下都安全。

### 边界条件

- accepted replay：第一次成功，第二次同 requestId 不新增 bid，不新增 event，不再次广播 accepted。
- rejected replay：第一次业务拒绝，第二次同 requestId 不新增 rejected bid，不新增 rejected event。
- processing：Redis key 仍是 `processing` 时，重复请求返回 `DUPLICATE_PROCESSING`，不写 MySQL。
- lock busy：拿不到 `auction:{auctionId}:lock` 时，写 rejected bid，reason 为 `lock_busy`，幂等 key 变为 rejected。
- lock release：锁释放或过期后，下一次合法 requestId 能继续出价。

### 测试设计

#### T4.1 accepted replay

1. 创建 Running auction。
2. HTTP 或 service 出价 109，requestId = `accepted-replay-1`。
3. 再次用同 userId、同 requestId 出价。
4. 断言：
   - 第二次返回 `idempotentReplay === true`。
   - accepted bid 行数仍为 1。
   - `bid.accepted` event 仍为 1。
   - current_price 只上涨一次。

#### T4.2 rejected replay

1. 创建 Running auction，下一口价 109。
2. 用户 A 用 requestId = `rejected-replay-1` 出价 119。
3. 再次用同 userId、同 requestId 出价 119。
4. 断言：
   - 两次都是 409。
   - rejected bid 行数仍为 1。
   - `bid.rejected` event 仍为 1。
   - Redis idempotency key 最终是 `rejected:{bidId}:{reason}`。
   - current_price 不变。

#### T4.3 processing

1. 创建 Running auction。
2. 直接写 Redis key：

```text
auction:{auctionId}:user:{userId}:request:{requestId} = processing
```

3. 调用同 requestId 出价。
4. 断言：
   - HTTP 409，error code 为 `DUPLICATE_PROCESSING`。
   - MySQL 不新增 bid。
   - MySQL 不新增 event。
   - current_price 不变。

#### T4.4 forced lock busy and release

1. 创建 Running auction。
2. 预先写入 `auction:{auctionId}:lock`，TTL 大于 300ms。
3. 使用新 requestId 出价 109。
4. 断言：
   - HTTP 409，error code 为 `LOCK_BUSY`。
   - MySQL 新增 rejected bid，`reject_reason = 'lock_busy'`。
   - `auction_events` 新增 `bid.rejected`。
   - Redis idempotency key 是 rejected。
5. 删除或等待 lock key 过期。
6. 使用另一个新 requestId 合法出价。
7. 断言：
   - 出价成功。
   - current_price 上涨一次。
   - 证明 lock busy 不会把竞拍永久卡死。

### 验收标准

- Redis accepted/rejected/processing 三态都有测试。
- MySQL 行数和 Redis 状态一致。
- 锁忙失败后仍然能继续合法出价。
- 不允许用“跳过 Redis”来完成这些测试。

## 8. 补充任务 T5 [P0]：自动延时的确定性边界测试

### 要防的风险

现有延时测试用“剩余 5 秒”触发，能跑但偏依赖时间。如果机器慢，出价时竞拍可能已经结束，测试会变 flaky。

### 边界条件

- 剩余时间刚好等于 `extendThresholdSec`，必须延时。
- 剩余时间大于 `extendThresholdSec`，不能延时。
- 达封顶价时优先 Sold，不能延时。
- 已经到期时不能延时，应触发结算或拒绝。
- 一次 accepted bid 最多写一条 `auction.extended`。
- 延时必须更新 MySQL `end_at` 和 `version`，不是前端假倒计时。

### 测试设计

1. 创建 Running auction 后，直接用 SQL 把 `end_at` 设置为 `NOW(3) + INTERVAL 10 SECOND`，同时 `extend_threshold_sec = 10`。
2. 出价成功后断言：
   - `extension !== null`。
   - `newEndAt > previousEndAt`。
   - MySQL `end_at` 等于或接近 response 中的 `newEndAt`。
   - `version` 增加。
   - `auction_events` 中 `auction.extended` 数量为 1。
   - 订阅 socket 收到 `auction.extended` 和后续 `auction.snapshot`。
3. 再创建一个 auction，把 `end_at` 设置为 `NOW(3) + INTERVAL 11 SECOND`：
   - 出价成功。
   - `extension === null`。
   - 不写 `auction.extended`。
4. 再创建封顶 auction：
   - 出价达到 ceiling。
   - auction `Sold`。
   - `extension === null`。
   - 不写 `auction.extended`。

### 验收标准

- 测试不依赖真实等待。
- 临界点 `<= threshold` 和 `> threshold` 都覆盖。
- HTTP response、Socket.IO event、MySQL `end_at/version/event` 四层证据一致。

## 9. 补充任务 T6 [P0]：按需结算 snapshot 的广播回归测试

### 要防的风险

用户通过 `GET /api/auctions/:id/snapshot` 触发到期结算，HTTP 返回已经 Sold/Passed，但订阅页面没有收到 `auction.sold` / `auction.passed` 和最新 snapshot。

### 边界条件

- Running 且有 winner，到期后 snapshot 推进到 Sold。
- Running 且没有 bid，到期后 snapshot 推进到 Passed。
- 已经 Sold/Passed 后重复请求 snapshot，不能重复创建订单，也不应重复广播“本次结算”事件。

### 测试设计

1. 创建 Running auction，用户 A 出一次有效价。
2. socket B join + subscribe。
3. SQL 设置 `end_at` 到过去。
4. 调用 `GET /api/auctions/:id/snapshot`。
5. 断言：
   - HTTP snapshot status 为 `Sold`。
   - socket B 收到 `auction.sold`，reason 为 `ended`。
   - socket B 收到最新 `auction.snapshot`。
   - `orders` 对该 auction 只有 1 条。
6. 创建另一个无 bid 的 Running auction，重复流程：
   - HTTP snapshot status 为 `Passed`。
   - socket 收到 `auction.passed`。
   - 没有 order。
7. 对 Sold auction 再次请求 snapshot：
   - order 仍为 1。
   - 短时间内不应再次收到新的 `auction.sold`。

### 验收标准

- Sold 和 Passed 两条按需结算路径都有实时广播。
- 重复 snapshot 不制造重复订单。
- 重复 snapshot 不重复发送终局结算事件。

## 10. 补充任务 T7 [P1]：前端 Socket.IO E2E 回归

### 要防的风险

API 层测试按顺序 emit 事件，不能覆盖浏览器里的真实 race。例如页面 connect 后必须先等 `room.join` ack，再 `auction.subscribe`。这个问题曾经导致支付事件服务端已发出，但页面没订阅成功。

### 边界条件

- 初次连接：join ack 后 subscribe。
- 双页面同步：A 出价，B 无刷新看到价格和领先者；B 出价，A 无刷新看到变化。
- 自动延时：收到 `auction.extended` 后倒计时变长。
- 支付广播：mock-pay 后页面显示 `订单 #id 已支付`。
- 断线恢复：断开后重连，页面能重新 join + subscribe，并显示最新 snapshot。
- 移动端 360-430px 不横向溢出、不文字重叠。

### 测试设计

新增一个最小 E2E 脚本或 Playwright 测试，例如：

```text
apps/web/src/test/live-room.e2e.ts
```

测试流程：

1. 启动 API 和 Web dev server，或在测试脚本里启动构建后的服务。
2. 创建一个独立 auction，设置 `startPrice=99`、`incrementStep=10`、`ceilingPrice=119`。
3. 打开两个浏览器页面 `/live/1`。
4. 页面 1 选择用户 A，页面 2 选择用户 B。
5. 等到两个页面 connection 都是 `connected`。
6. 用户 A 点击出价：
   - 页面 2 看到 `¥109.00` 和领先者 A。
7. 用户 B 点击出价：
   - 页面 1 看到 `¥119.00`、成交结果和领先者 B。
8. 调 mock-pay：
   - 页面 1 或页面 2 出现 `订单 #<id> 已支付`。
9. 设置 viewport 390x800：
   - `document.documentElement.scrollWidth <= clientWidth + 1`。
   - 核心按钮和 metric 区域没有元素右边界超过 viewport。

### 验收标准

- 该 E2E 可以用一条命令运行，例如 `npm run test:e2e`。
- E2E 不依赖手工点击。
- 支付广播 race 被自动化覆盖。
- 390px viewport 无水平溢出。

## 11. 补充任务 T8 [P1]：并发脚本多模式验证

### 要防的风险

当前 `npm run demo:concurrency` 只覆盖“100 个不同 requestId 同时抢同一口价”。它能证明订单唯一性，但还不能证明重复请求模式和锁忙模式。

### 边界条件

- unique 模式：100 个不同用户、不同 requestId、同一下一口价。
- duplicate accepted replay 模式：同一个 userId + requestId 在成功后重复提交。
- duplicate rejected replay 模式：同一个 userId + requestId 在业务拒绝后重复提交。
- forced lock busy 模式：人为占住 Redis lock，验证 lockBusy 统计和 rejected bid 行数一致。

### 测试设计

扩展脚本参数：

```bash
npm run demo:concurrency -- --mode=unique
npm run demo:concurrency -- --mode=duplicate-accepted
npm run demo:concurrency -- --mode=duplicate-rejected
npm run demo:concurrency -- --mode=lock-busy
```

输出必须包含：

```text
mode=...
auctionId=...
attempts=...
accepted=...
rejected=...
duplicate=...
lockBusy=...
businessRejected=...
orderCount=...
acceptedBidRows=...
rejectedBidRows=...
rejectedEventRows=...
```

每种模式的通过口径：

- `unique`
  - `attempts=100`
  - `accepted=1`
  - `rejected=99`
  - `orderCount=1`
  - `acceptedBidRows=1`
  - `rejectedBidRows=99`
- `duplicate-accepted`
  - 第一次 accepted。
  - 后续重复请求不新增 bid。
  - current_price 只上涨一次。
  - `bid.accepted` event 只有 1。
- `duplicate-rejected`
  - 第一次 rejected。
  - 后续重复请求不新增 rejected bid。
  - `bid.rejected` event 只有 1。
- `lock-busy`
  - `lockBusy` 等于 MySQL `reject_reason='lock_busy'` 行数。
  - lock 释放后新 requestId 能成功出价。

### 验收标准

- 四种模式都能重复运行。
- 每种模式输出的统计和 MySQL 抽查一致。
- 脚本失败时必须输出 `mode` 和 `auctionId`，方便追查。

## 12. 补充任务 T9 [P1]：测试工具和断言辅助函数

### 要防的风险

实时测试里很容易只写“等待某事件”，却不写“确认某事件没发给错误的人”。没有辅助函数时，负例会写得松散，后续容易漏。

### 建议新增测试 helper

新增 `apps/api/src/test/realtime-test-helpers.ts`：

- `openSocket(url)`
- `sendRealtime(socket, event, payload)`
- `waitForRealtimeEvent(socket, eventName, predicate, timeoutMs)`
- `expectNoRealtimeEvent(socket, eventName, predicate, timeoutMs)`
- `joinAndSubscribe(socket, roomId, userId, auctionId)`
- `createSecondRoom(pool, suffix)`
- `countBids(pool, auctionId, filters)`
- `countEvents(pool, auctionId, eventType)`

### 验收标准

- 新增测试尽量复用 helper，不复制大量 socket 监听代码。
- `expectNoRealtimeEvent` 必须真的等待一个短 timeout，不能只是同步检查。
- helper 不隐藏业务断言；测试本体仍要写清楚为什么应该收到或不该收到事件。

## 13. 总体验收命令

补充测试完成后，至少运行：

```bash
npm run check:env
npm run redis:ping
npm run test
npm run build
npm run demo:concurrency
```

如果新增前端 E2E，再运行：

```bash
npm run test:e2e
```

通过标准：

- shared 测试通过。
- API 集成测试通过，并且包含 T1-T6 的新增断言。
- build 通过。
- 并发脚本通过，并且至少 unique 模式有 MySQL 证据。
- 如果已实现 T8，多模式并发脚本全部通过。
- 如果已实现 T7，浏览器 E2E 能证明双页面实时同步、支付广播和移动端无溢出。

## 14. 最终汇报必须包含的证据

最终交付时不能只说“测试通过”，需要列出：

- `npm run test` 的通过摘要。
- `npm run build` 的通过摘要。
- 每个新增测试节点对应的测试名。
- 并发脚本输出中的 `auctionId`、`accepted`、`rejected`、`lockBusy`、`orderCount`。
- MySQL 抽查：
  - `orders` 数量。
  - accepted/rejected bid 行数。
  - `bid.rejected` event 行数。
- 前端 E2E 证据：
  - 双页面价格同步。
  - mock-pay 后页面出现 `订单 #id 已支付`。
  - 390px viewport 无水平溢出。

## 15. 完成判定

这个补充测试 spec 完成后，节点 3 的质量判断从：

```text
主链路跑通，演示可见。
```

升级为：

```text
主链路、实时路由、房间隔离、失败反馈、Redis 幂等/锁、到期结算、前端 race 和移动端布局都有自动化或可重复证据。
```

只有 T1-T6 全部完成，才算节点 3 的 P0 测试补强完成。T7-T9 是 P1，但建议在进入节点 4 演示冻结前完成。
