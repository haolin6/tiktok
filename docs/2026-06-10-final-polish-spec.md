# 2026-06-10 最后五项完善方案

## 目标

在不扩大项目边界、不临时引入高风险部署能力的前提下，完成最后五项完善：

1. 补充 AI 协作流程和人工决策证据。
2. README 增加演示视频亮点说明。
3. `final_acceptance_log.md` 增加最后小改后的真实验收记录。
4. 增强直播间竞价氛围动画和排名反馈。
5. 实现多档出价和 `+ / -` 加价器。

本方案的核心原则是：先让竞拍规则稳定，再做前端体验，最后写材料和验收日志。最终文档只能记录真实跑过的命令结果，不伪造通过。

## 当前仓库环境

仓库路径：`/Users/haolin6/Documents/tiktok`

当前已有能力：

- 商家端发布竞拍、配置起拍价、加价幅度、时长、封顶价和延时机制。
- 商家端查看竞拍列表、启动、取消、编辑未开始竞拍规则。
- 订单列表、模拟支付、我的订单和出价历史。
- 用户端直播间展示当前竞拍、当前价、下一口价、倒计时、领先者、排行榜和在线人数。
- WebSocket 同步 `bid.accepted`、`user.outbid`、`auction.extended`、`auction.sold`、`auction.passed`、`auction.canceled`、`order.paid`、`room.presence`。
- Redis lock、Redis 幂等 key、MySQL 事务和唯一约束。
- 本机 100 并发出价一致性脚本和 100/200 Socket.IO fanout 脚本。

当前未覆盖或弱覆盖：

- 用户端只有“下一口价一键出价”，没有多档金额选择。
- 直播间更偏功能型面板，不像真实 H5 竞拍卡片。
- 领先、被超越、最后倒计时、成交结果的视觉反馈还不够强。
- 最后一次小改后的验收记录需要补充。

## 非目标

本轮不做以下能力：

- 线上 Demo 部署。
- 真实图片文件上传。
- 真实支付、物流、售后。
- 完整登录鉴权、多角色权限网关。
- Redis 读写分离、数据库读写分离。
- 线上 1000+ 用户压测。
- 多直播间商品抽屉、完整商品列表浏览和商品详情半屏页。
- 运行时大模型 API、RAG 或向量库。

说明：真实直播间截图中的商品抽屉、完整商品列表和活动 tab 是产品形态增强，不是本轮五项完善的必要范围。本轮只把当前单竞拍直播间增强为更接近 H5 竞拍卡的形态。

## 修改顺序

### Step 0 基线检查

目的：确认开始修改前的工作区状态，避免误把已有未提交文件覆盖。

执行：

```bash
git status --short
npm run test -w @live-auction/shared
npm run test -w @live-auction/api
```

说明：

- 当前存在未提交的演示提交文档，后续提交时需要明确是否纳入。
- 如果基线测试失败，先判断是否由本地 MySQL/Redis 状态导致，不直接改业务代码掩盖问题。

### Step 1 多档出价后端规则

先改后端是为了固定竞拍事实来源，前端只做金额选择和展示。

涉及文件：

- `apps/api/src/services/auctions-service.ts`
- `apps/api/src/routes/auctions-routes.ts`
- `packages/shared/src/api-types.ts`（如需要补充响应字段）
- `apps/api/src/test/api.integration.test.ts`
- `apps/api/src/realtime/realtime-hub.ts`（如需要同步新的金额语义）

#### 新规则

当前价为 `currentPrice`，加价幅度为 `incrementStep`，封顶价为 `ceilingPrice`。

1. 最低可出价仍由 `calculateNextBidAmount` 计算。
2. 用户请求金额可以大于最低下一口价。
3. 用户请求金额必须按 `incrementStep` 对齐。
4. 用户可以自己超过自己。
5. 如果请求金额超过封顶价，后端防御性截断为封顶价。
6. 封顶价允许作为终点例外，即使封顶价与步长不完全对齐。
7. 金额达到封顶价后立即成交，并生成订单。
8. 幂等请求重复提交时不得重复涨价或重复生成订单。

示例：

| 当前价 | 加价幅度 | 封顶价 | 请求金额 | 处理结果 |
|---:|---:|---:|---:|---|
| 850 | 50 | 1000 | 900 | 接受，当前价 900 |
| 850 | 50 | 1000 | 950 | 接受，当前价 950 |
| 850 | 50 | 1000 | 1000 | 接受，成交 |
| 850 | 50 | 1000 | 920 | 拒绝，未按步长对齐 |
| 850 | 50 | 1000 | 1050 | 截断为 1000，接受并成交 |
| 850 | 50 | 980 | 980 | 接受，成交，封顶例外 |
| 850 | 50 | 980 | 1000 | 截断为 980，接受并成交 |

#### 后端校验算法

在 Redis lock 和 MySQL 事务内读取最新竞拍状态后执行：

```text
1. 如果竞拍不是 Running，按现有逻辑拒绝。
2. 计算 latestNextBidAmount。
3. 如果 latestNextBidAmount 为 null，拒绝。
4. effectiveAmount = request.amount。
5. 如果 ceilingPrice 不为 null 且 effectiveAmount > ceilingPrice，则 effectiveAmount = ceilingPrice。
6. 如果 effectiveAmount < latestNextBidAmount，拒绝。
7. 如果 effectiveAmount !== ceilingPrice，则要求：
   (effectiveAmount - currentPrice) 必须是 incrementStep 的整数倍。
8. 如果 effectiveAmount === ceilingPrice，则允许作为封顶终点。
9. 写入 accepted bid，amount 使用 effectiveAmount。
10. 更新 auction.currentPrice 和 auction.currentWinnerId。
11. 记录 bid.accepted 事件，payload.amount 使用 effectiveAmount。
12. 如果 effectiveAmount 达到 ceilingPrice，则 settle 为 Sold。
```

金额比较必须继续使用 cents 级整数转换，避免小数误差。

#### 并发最低成本方案

不做自动追价、不做排队、不做智能补差价。所有请求进入 Redis lock 后，用数据库里的最新 `currentPrice` 重新校验。

场景：

```text
当前价 850，步长 50。
A 请求 950，B 请求 900。
```

- 如果 A 先拿锁，当前价变 950；B 后拿锁时 900 低于最新下一口价 1000，B 被拒绝。
- 如果 B 先拿锁，当前价变 900；A 后拿锁时 950 仍合法，A 成功。

场景：

```text
当前价 850，步长 50。
A 请求 950，B 请求 1000。
```

- 不论谁先拿锁，最终 1000 都应能成为最高价；如果 1000 是封顶价，则最终成交。

#### `user.outbid` 规则

- A 被 B 超过时，A 收到 `user.outbid`。
- A 自己从 900 加到 950 时，不发送 `user.outbid` 给 A。
- `bid.accepted.payload.previousWinnerId` 仍记录事务内旧领先者。
- `user.outbid` 只在 `previousWinnerId !== null && previousWinnerId !== newWinnerId` 时发送。

#### API 测试

新增或修改 `apps/api/src/test/api.integration.test.ts`：

- 接受最低下一口价。
- 接受多档出价，例如当前价 850、步长 50、请求 950。
- 拒绝非步长金额，例如请求 920。
- 拒绝低于最新下一口价的金额。
- 允许当前领先者自己继续加价。
- 请求金额超过封顶价时截断为封顶价，并生成成交订单。
- 封顶价不按步长对齐时，封顶价作为终点仍可接受。
- 多用户顺序竞争时按最新价格校验：
  - 950 成功后 900 拒绝。
  - 900 成功后 950 成功。
- 同一 requestId 幂等回放不重复涨价。
- 同一用户自己加价时不发送 `user.outbid`。
- 其他用户超过 previous winner 时仍发送 `user.outbid`。

需要同步更新旧断言：

- 旧测试中类似“请求 119 必须被拒绝，因为不是下一口价”的断言不再成立。
- 新拒绝用例应改成非步长金额、低于最新下一口价，或非 Running 状态。

### Step 2 前端加价器和实时同步

后端规则稳定后，再把用户端从“一键下一口价”升级为“本地选择金额 + 立即出价”。

涉及文件：

- `apps/web/src/App.tsx`
- `apps/web/src/styles.css`
- `apps/web/src/test/live-room.e2e.ts`

#### 新增前端状态

在 `LiveRoomPage` 中新增：

```ts
const [selectedBidAmount, setSelectedBidAmount] = useState<number | null>(null);
const [bidAmountNotice, setBidAmountNotice] = useState<string | null>(null);
```

推荐新增 helper：

```ts
function normalizeBidAmountForSnapshot(
  current: number | null,
  snapshot: AuctionSnapshotResponse
): { amount: number | null; notice: string | null }
```

#### 金额同步规则

1. 首次拿到 snapshot：
   - 如果 `snapshot.nextBidAmount !== null`，默认选中 `nextBidAmount`。
   - 否则为 `null`。
2. 用户点 `+`：
   - 从当前选择金额增加 `incrementStep`。
   - 如果超过 `ceilingPrice`，自动变成 `ceilingPrice`。
   - 显示“已到封顶价”。
3. 用户点 `-`：
   - 减少 `incrementStep`。
   - 不得低于最新 `nextBidAmount`。
4. 收到 WebSocket 或 snapshot 刷新：
   - 如果竞拍不再是 `Running`，清空选择并禁用按钮。
   - 如果当前选择金额低于最新 `nextBidAmount`，自动重置为最新 `nextBidAmount`，提示“价格已更新”。
   - 如果当前选择金额仍高于或等于最新 `nextBidAmount` 且仍合法，保留当前选择。
   - 如果当前选择金额超过封顶价，截断为封顶价并提示“已到封顶价”。
5. 出价请求提交 `selectedBidAmount`，不再固定提交 `snapshot.nextBidAmount`。

示例：

```text
当前价 850，下一口价 900。
用户本地选 1000。
另一用户出到 900。
最新下一口价变 950，用户本地 1000 仍合法，保留。
```

```text
当前价 850，下一口价 900。
用户本地选 950。
另一用户直接出到 1000。
如果竞拍未封顶，最新下一口价变 1050，用户本地 950 过期，自动重置为 1050。
```

#### UI 结构

在直播间右侧面板中，将原按钮附近增强为竞拍卡片：

- 商品图、商品标题。
- 当前价。
- 我的出价。
- 加价幅度。
- `-` 按钮。
- 当前选择金额。
- `+` 按钮。
- `立即出价 ¥xxx` 按钮。
- 封顶价提示。

建议 data-testid：

- `bid-sheet`
- `selected-bid-amount`
- `increase-bid`
- `decrease-bid`
- `bid-amount-notice`
- `bid-button`

#### 前端 E2E

新增或修改 Playwright：

- 默认选中下一口价。
- 点击 `+` 后金额增加一个 `incrementStep`。
- 点击 `-` 后金额下降，但不低于下一口价。
- 点击多次 `+` 超过封顶价时，金额停在封顶价并显示“已到封顶价”。
- 以多档金额出价成功后，当前价变为该金额。
- 当前领先用户再次加价成功。
- A 被 B 多档金额超过后，A 页面显示被超越提示。
- 竞拍成交、流拍、取消后，加价器禁用。

### Step 3 竞价氛围动画和排名反馈

这一阶段不改变业务事实，只增强视觉反馈。

涉及文件：

- `apps/web/src/App.tsx`
- `apps/web/src/styles.css`
- `apps/web/src/test/live-room.e2e.ts`（只补稳定可断言的内容）

#### 领先反馈

当前用户领先时：

- 显示“领先中”或“当前您已是最高价”。
- 当前价轻微 pulse。
- 排行榜中当前用户高亮。

#### 被超越反馈

收到 `user.outbid` 时：

- 提示文案使用“已被超越，当前价 ¥xxx”。
- `.notice.outbid` 增加轻微 shake。
- 不使用遮挡主流程的大弹层，避免影响继续出价。

#### 倒计时紧张感

剩余时间 <= 10 秒：

- 倒计时卡片变红。
- 数字 pulse。

剩余时间 <= 3 秒：

- 可以增强为更快 pulse，但必须避免文字溢出。

#### 自动延时反馈

收到 `auction.extended`：

- 提示“已自动延时 xs，到 HH:mm:ss”。
- 使用蓝色或冷色提示，区别于成功和错误。

#### 成交/流拍/取消结果卡

终态时显示更明确的结果卡：

- Sold 且当前用户是赢家：显示成交金额和“去支付”。
- Sold 且当前用户不是赢家：显示成交金额和“未成交”。
- Passed：显示“竞拍已流拍，无人成交”。
- Canceled：显示“竞拍已取消”。

#### 排名反馈

增强当前已有排行榜：

- 当前用户所在行高亮。
- 第一名样式突出。
- 显示“你当前第 x 名”。
- 如果不是第一名，显示“距领先者差 ¥xx”。
- 如果当前用户无出价，显示“暂无出价”。

#### CSS 动画边界

必须加入无障碍降级：

```css
@media (prefers-reduced-motion: reduce) {
  .notice.outbid,
  .metric-grid .countdown-hot strong,
  .price-board.leading strong,
  .bid-button:not(:disabled) {
    animation: none;
    transition: none;
  }
}
```

不加入自动播放提示音作为必做项。提示音受浏览器自动播放策略影响，录屏不稳定；如果做，只能在用户首次点击后允许播放。

### Step 4 文档材料增强

代码和测试稳定后，再补材料，避免文档写到未完成能力。

#### 4.1 AI 人工决策表

涉及文件：

- `docs/ai_usage_evidence.md`

新增小节建议命名：

```md
## 最后阶段人工决策记录
```

表格字段：

```md
| 决策点 | AI 辅助建议 | 人工判断 | 最终取舍 | 证据 |
|---|---|---|---|---|
```

建议内容：

- 线上 Demo：不临时部署，用公开视频和本地验收替代。
- 1000+ 在线：不写成，只写本机 100/200 fanout。
- 多档出价：初始评估成本较高，但任务要求和真实竞拍形态需要，因此纳入 增强。
- 加价器规则：允许多档、步长对齐、自己超过自己、超封顶截断。
- 提示音：浏览器限制和录屏稳定性原因，不作为必做项。

注意：

- 不写 AI 代码参与比例数字。
- 采用工程事实表述，避免目的导向过强的表达。
- 重点写工程协作、风险收敛、人工把控和验证证据。

#### 4.2 README 视频亮点说明

涉及文件：

- `README.md`

在演示视频说明后补一句：

```md
视频覆盖：后台发布与延时参数、Scheduled 规则编辑、A/B/C 常驻用户直播间、实时出价同步、多档出价、被超越提醒、自动延时、封顶成交、模拟支付、流拍/取消终态、100 并发一致性和 200 fanout 证据。
```

如果多档出价未实现，不得写入这句中的“多档出价”。

#### 4.3 最后小改验收记录

涉及文件：

- `docs/final_acceptance_log.md`

新增小节：

```md
## 2026-06-10 最后五项完善补充验收

最后完善内容：
- AI 人工决策表。
- README 视频亮点说明。
- 多档出价和加价器。
- 直播间竞价氛围动画与排名反馈。
- 最后小改验收记录。

补充验收：
- npm run build：通过/失败，附摘要。
- npm run test -w @live-auction/shared：通过/失败，附摘要。
- npm run test -w @live-auction/api：通过/失败，附摘要。
- npm run test:e2e：通过/失败，附摘要。
```

要求：

- 只记录真实执行结果。
- 若命令失败，必须写失败原因和未完成风险。
- 如果因为时间只跑了部分命令，写“未执行”，不能写“通过”。

### Step 5 总体验证和提交前检查

最终建议执行：

```bash
npm run build
npm run test -w @live-auction/shared
npm run test -w @live-auction/api
npm run test:e2e
git diff --check
rg -n "<stale-material-keywords>" README.md docs
```

如果 E2E 受端口影响：

- 确认 `3000/4000` 没有旧服务占用。
- 不要直接改测试绕过真实页面问题。

提交前检查：

- README 不写未完成能力。
- `docs/final_acceptance_log.md` 与真实命令结果一致。
- `docs/ai_usage_evidence.md` 不出现 AI 参与比例数字。
- B 站公开视频链接仍是当前链接。
- 演示提交文档是否纳入提交需要确认。

## 详细测试矩阵

### 后端 API

| 场景 | 输入 | 预期 |
|---|---|---|
| 最低下一口价 | 当前 850，步长 50，请求 900 | 接受，当前价 900 |
| 多档出价 | 当前 850，步长 50，请求 950 | 接受，当前价 950 |
| 非步长金额 | 当前 850，步长 50，请求 920 | 拒绝 |
| 低于最新下一口价 | 当前 950，步长 50，请求 900 | 拒绝 |
| 自己超过自己 | A 先 900，A 再 950 | 接受，不发送 outbid |
| 他人超过 | A 900，B 950 | 接受，A 收到 outbid |
| 超封顶截断 | 当前 850，封顶 1000，请求 1050 | 按 1000 接受并成交 |
| 封顶非步长 | 当前 850，步长 50，封顶 980，请求 980 | 接受并成交 |
| 幂等回放 | 同 requestId 重复成功请求 | 不重复涨价，不重复订单 |
| 非 Running | Scheduled/Sold/Passed/Canceled 请求出价 | 拒绝 |

### WebSocket

| 场景 | 预期 |
|---|---|
| 多档出价成功 | `bid.accepted.payload.amount` 是实际接受金额 |
| 超封顶截断 | 广播金额和订单金额都是封顶价 |
| 他人超过 previous winner | 只 previous winner 收到 `user.outbid` |
| 自己超过自己 | 不发送 `user.outbid` |
| 成交 | `auction.sold` 后 snapshot 终态一致 |
| 取消 | 用户端收到取消后倒计时归零，加价器禁用 |

### 前端 E2E

| 场景 | 预期 |
|---|---|
| 默认金额 | 打开直播间后 `selected-bid-amount` 等于下一口价 |
| 点击加号 | 金额增加一个加价幅度 |
| 点击减号 | 金额减少一个加价幅度，但不低于下一口价 |
| 到封顶价 | 加号停止在封顶价，显示“已到封顶价” |
| 多档出价 | 点击出价后当前价更新为选择金额 |
| 自己加价 | 领先用户继续加价成功，显示“当前您已是最高价” |
| 被超越 | A 被 B 超过后 A 看到被超越提示 |
| 倒计时 | 最后 10 秒进入 hot 样式，文本不溢出 |
| 终态 | Sold/Passed/Canceled 禁用加价器并显示结果 |
| 移动端 | 390px 宽度下按钮、金额、提示不重叠 |

### 文档

| 文件 | 检查 |
|---|---|
| `README.md` | 有视频亮点说明，不写成线上 Demo/1000+ |
| `docs/ai_usage_evidence.md` | 有人工决策表，无 AI 参与比例数字 |
| `docs/final_acceptance_log.md` | 只写真实执行结果 |
| `docs/project_delivery_summary.md` | 如涉及多档出价，和代码事实一致 |
| 演示提交文档 | 如纳入提交，视频链接和最新能力一致 |

## 验收标准

本轮完成必须同时满足：

1. 多档出价规则在 API、WebSocket、前端页面和测试中一致。
2. `+ / -` 加价器不能生成低于下一口价或超过封顶价的无效前端金额。
3. 后端仍是竞拍事实来源，前端金额选择只作为用户输入。
4. 并发下仍以 Redis lock 内最新价格为准。
5. 幂等请求仍不重复涨价、不重复生成订单。
6. 自己超过自己可以成功，但不触发被超越事件。
7. 他人超过 previous winner 时定向提醒仍正确。
8. README、AI 证据和最终验收日志不写未完成能力。
9. `npm run build`、`npm run test -w @live-auction/shared`、`npm run test -w @live-auction/api` 通过。
10. 如修改前端交互，`npm run test:e2e` 应通过；若未执行，必须在验收日志中如实写明。

## 风险和回滚点

### 风险 1 旧测试语义变化

多档出价会改变“金额必须等于下一口价”的旧规则。旧测试需要改成验证“低于最低价拒绝”和“非步长拒绝”，不能继续用高于下一口价作为拒绝条件。

### 风险 2 封顶价和步长不对齐

封顶价应作为特殊终点处理。否则用户可能永远无法以合法步长触达封顶价。

### 风险 3 前端本地金额过期

WebSocket 更新后，如果本地选择金额低于最新下一口价，必须自动重置，否则用户点击会被后端拒绝，体验很差。

### 风险 4 E2E 稳定性

倒计时和实时事件容易有时间抖动。E2E 应优先断言稳定文本、状态和 data-testid，不依赖毫秒级动画。

### 风险 5 文档抢跑

最终验收日志必须最后写。任何没有真实跑过的命令都不能写通过。

## 建议实施拆分

建议按以下提交或阶段拆：

1. `Implement multi-step bidding rules`
   - 后端规则、API 测试、WebSocket 语义。
2. `Add live bid increment controls`
   - 前端加价器、实时同步、E2E。
3. `Polish live bidding feedback`
   - 动画、排行榜高亮、结果卡。
4. `Update final delivery evidence`
   - AI 决策表、README 视频亮点、最终验收日志。

如果时间不足，优先级为：

1. 后端多档出价规则和 API 测试。
2. 前端加价器。
3. 最后验收日志。
4. README 视频亮点。
5. AI 人工决策表。
6. 动画和视觉增强。
