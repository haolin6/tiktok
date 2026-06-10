import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type {
  AuctionDetailResponse,
  AuctionListResponse,
  CreateAuctionResponse,
  CreateProductResponse,
  DemoContextResponse,
  MockPayOrderResponse,
  OrderListResponse
} from "@live-auction/shared";

async function apiGet<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  expect(response.ok()).toBe(true);
  return (await response.json()) as T;
}

async function apiPost<T>(
  request: APIRequestContext,
  path: string,
  data?: Record<string, unknown>
): Promise<T> {
  const response = await request.post(path, data === undefined ? undefined : { data });
  expect(response.ok()).toBe(true);
  return (await response.json()) as T;
}

async function createRunningAuction(
  request: APIRequestContext,
  roomId: number,
  title: string
): Promise<CreateAuctionResponse> {
  return createAuctionFixture(request, roomId, title, { start: true });
}

async function createAuctionFixture(
  request: APIRequestContext,
  roomId: number,
  title: string,
  options: Partial<{
    start: boolean;
    startPrice: number;
    incrementStep: number;
    ceilingPrice: number | null;
    endMsFromNow: number;
    extendThresholdSec: number;
    extendDurationSec: number;
  }> = {}
): Promise<CreateAuctionResponse> {
  const product = await apiPost<CreateProductResponse>(request, "/api/products", {
    title,
    imageUrl: "https://example.com/e2e-product.png",
    description: "Created by Playwright live-room E2E."
  });
  const now = Date.now();
  const auction = await apiPost<CreateAuctionResponse>(request, "/api/auctions", {
    roomId,
    productId: product.product.id,
    startPrice: options.startPrice ?? 99,
    incrementStep: options.incrementStep ?? 10,
    ceilingPrice: options.ceilingPrice === undefined ? 119 : options.ceilingPrice,
    startAt: new Date(now - 1_000).toISOString(),
    endAt: new Date(now + (options.endMsFromNow ?? 60_000)).toISOString(),
    extendThresholdSec: options.extendThresholdSec ?? 10,
    extendDurationSec: options.extendDurationSec ?? 15
  });

  if (!options.start) {
    return auction;
  }

  return apiPost<CreateAuctionResponse>(request, `/api/auctions/${auction.auction.id}/start`);
}

async function openLiveRoom(
  page: Page,
  roomId: number,
  title: string,
  userButtonName: string | undefined,
  auctionId: number
): Promise<void> {
  await page.goto(`/live/${roomId}?auctionId=${auctionId}`);
  if (userButtonName) {
    await page.getByRole("button", { name: userButtonName }).click();
  }
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByTestId("connection-status")).toHaveText("connected");
}

test("live room keeps two pages synchronized through bids, sold state, payment, and mobile layout", async ({
  browser,
  request
}) => {
  const demo = await apiGet<DemoContextResponse>(request, "/api/demo/context");
  const suffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`;
  const title = `E2E实时竞拍商品 ${suffix}`;
  const started = await createRunningAuction(request, demo.room.id, title);
  const auctionId = started.auction.id;

  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  try {
    await openLiveRoom(pageA, demo.room.id, title, demo.bidders[0]?.nickname, auctionId);
    await openLiveRoom(pageB, demo.room.id, title, demo.bidders[1]?.nickname, auctionId);

    await pageA.getByTestId("bid-button").click();
    await expect(pageB.getByTestId("current-price")).toHaveText("¥109.00");
    await expect(pageB.getByTestId("leader")).toHaveText(demo.bidders[0]!.nickname);

    await pageB.getByTestId("bid-button").click();
    await expect(pageA.getByTestId("current-price")).toHaveText("¥119.00");
    await expect(pageA.getByTestId("leader")).toHaveText(demo.bidders[1]!.nickname);
    await expect(pageA.getByText("成交", { exact: true })).toBeVisible();

    const list = await apiGet<AuctionListResponse>(request, "/api/auctions");
    expect(list.items.find((item) => item.id === auctionId)?.status).toBe("Sold");
    const orders = await apiGet<OrderListResponse>(request, "/api/orders");
    const order = orders.items.find((item) => item.auctionId === auctionId);
    expect(order).toBeDefined();

    const pay = await apiPost<MockPayOrderResponse>(
      request,
      `/api/orders/${order!.id}/mock-pay`
    );
    expect(pay.order.status).toBe("paid");
    await expect(pageA.getByTestId("notice")).toHaveText(`订单 #${order!.id} 已支付`);

    await pageA.setViewportSize({ width: 390, height: 800 });
    await expect(pageA.getByTestId("auction-panel")).toBeVisible();
    await expect(pageA.getByTestId("metric-grid")).toBeVisible();
    await expect(pageA.getByTestId("bid-sheet")).toBeVisible();
    await expect(pageA.getByTestId("bid-button")).toBeVisible();
    const layout = await pageA.evaluate(() => {
      const documentElement = document.documentElement;
      const viewportWidth = documentElement.clientWidth;
      const selectors = [
        "[data-testid='auction-panel']",
        "[data-testid='metric-grid']",
        "[data-testid='bid-sheet']",
        "[data-testid='bid-button']",
        "[data-testid='current-price']"
      ];
      const overflowing = selectors.filter((selector) => {
        const element = document.querySelector(selector);
        if (!element) {
          return true;
        }
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > viewportWidth + 1;
      });

      return {
        scrollWidth: documentElement.scrollWidth,
        clientWidth: viewportWidth,
        overflowing
      };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.overflowing).toEqual([]);
  } finally {
    await context.close();
  }
});

test("live room bid incrementer supports multi-step amounts and ceiling clamp", async ({ page, request }) => {
  const demo = await apiGet<DemoContextResponse>(request, "/api/demo/context");
  const suffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`;
  const title = `E2E多档加价器商品 ${suffix}`;
  const started = await createAuctionFixture(request, demo.room.id, title, {
    start: true,
    startPrice: 850,
    incrementStep: 50,
    ceilingPrice: 1000
  });

  await openLiveRoom(page, demo.room.id, title, demo.bidders[0]?.nickname, started.auction.id);
  await expect(page.getByTestId("selected-bid-amount")).toHaveText("¥900.00");

  await page.getByTestId("increase-bid").click();
  await expect(page.getByTestId("selected-bid-amount")).toHaveText("¥950.00");
  await page.getByTestId("decrease-bid").click();
  await expect(page.getByTestId("selected-bid-amount")).toHaveText("¥900.00");

  await page.getByTestId("increase-bid").click();
  await page.getByTestId("increase-bid").click();
  await expect(page.getByTestId("selected-bid-amount")).toHaveText("¥1000.00");
  await expect(page.getByTestId("bid-amount-notice")).toHaveText("已到封顶价");

  await page.getByTestId("bid-button").click();
  await expect(page.getByTestId("current-price")).toHaveText("¥1000.00");
  await expect(page.getByText("成交", { exact: true })).toBeVisible();
  await expect(page.getByTestId("bid-button")).toBeDisabled();
});

test("admin auction list cancels a running auction from the page", async ({ page, request }) => {
  const demo = await apiGet<DemoContextResponse>(request, "/api/demo/context");
  const suffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`;
  const title = `E2E管理端取消商品 ${suffix}`;
  const started = await createRunningAuction(request, demo.room.id, title);
  const auctionId = started.auction.id;

  await page.goto("/admin/auctions");
  const row = page.locator(".table-row", { hasText: `#${auctionId}` });
  await expect(row).toBeVisible();
  await expect(row.getByText("竞拍中")).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("请输入取消原因");
    await dialog.accept("e2e admin cancel");
  });

  await row.getByRole("button", { name: `取消竞拍 #${auctionId}` }).click();
  await expect(row.getByText("已取消")).toBeVisible();

  const list = await apiGet<AuctionListResponse>(request, "/api/auctions");
  expect(list.items.find((item) => item.id === auctionId)?.status).toBe("Canceled");
});

test("permanent live room keeps the canceled auction after a bid and does not show an old payment link", async ({
  page,
  request
}) => {
  const demo = await apiGet<DemoContextResponse>(request, "/api/demo/context");
  const bidderA = demo.bidders[0]!;
  const suffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`;
  const existingAuctions = await apiGet<AuctionListResponse>(request, "/api/auctions");
  for (const auction of existingAuctions.items) {
    if (auction.roomId === demo.room.id && auction.status === "Running") {
      await apiPost(request, `/api/auctions/${auction.id}/cancel`, {
        reason: "e2e isolate permanent room regression"
      });
    }
  }

  const oldSold = await createAuctionFixture(request, demo.room.id, `E2E旧成交商品 ${suffix}`, {
    start: true,
    ceilingPrice: 109
  });
  await apiPost(request, `/api/auctions/${oldSold.auction.id}/bids`, {
    userId: bidderA.id,
    amount: 109,
    requestId: `${suffix}-old-sold`
  });
  const orders = await apiGet<OrderListResponse>(request, "/api/orders");
  expect(orders.items.find((item) => item.auctionId === oldSold.auction.id)?.buyerId).toBe(
    bidderA.id
  );

  await page.goto(`/live/${demo.room.id}?userId=${bidderA.id}`);
  await expect(page.getByRole("heading", { name: `E2E旧成交商品 ${suffix}` })).toBeVisible();
  await expect(page.getByRole("link", { name: "去支付" })).toBeVisible();

  const currentTitle = `E2E取消后保留当前场 ${suffix}`;
  const current = await createAuctionFixture(request, demo.room.id, currentTitle, {
    start: true,
    ceilingPrice: null
  });
  await apiPost(request, `/api/auctions/${current.auction.id}/bids`, {
    userId: bidderA.id,
    amount: 109,
    requestId: `${suffix}-current-before-cancel`
  });
  await apiPost(request, `/api/auctions/${current.auction.id}/cancel`, {
    reason: "e2e cancel after a bid"
  });

  await expect(page.getByRole("heading", { name: currentTitle })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("已取消", { exact: true })).toBeVisible();
  await expect(page.getByTestId("remaining-time")).toHaveText("0.0s");
  await page.waitForTimeout(3_500);
  await expect(page.getByRole("heading", { name: currentTitle })).toBeVisible();
  await expect(page.getByTestId("remaining-time")).toHaveText("0.0s");
  await expect(page.getByRole("link", { name: "去支付" })).toHaveCount(0);
});

test("live room shows an outbid notice without selling the auction", async ({ browser, request }) => {
  const demo = await apiGet<DemoContextResponse>(request, "/api/demo/context");
  const suffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`;
  const title = `E2E被超越提醒商品 ${suffix}`;
  const started = await createAuctionFixture(request, demo.room.id, title, {
    start: true,
    ceilingPrice: null
  });
  const auctionId = started.auction.id;

  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  try {
    await openLiveRoom(pageA, demo.room.id, title, demo.bidders[0]?.nickname, auctionId);
    await openLiveRoom(pageB, demo.room.id, title, demo.bidders[1]?.nickname, auctionId);

    await pageA.getByTestId("bid-button").click();
    await expect(pageB.getByTestId("current-price")).toHaveText("¥109.00");
    await expect(pageA.getByText("当前您已是最高价")).toBeVisible();

    await pageA.getByTestId("increase-bid").click();
    await pageA.getByTestId("bid-button").click();
    await expect(pageB.getByTestId("current-price")).toHaveText("¥129.00");
    await expect(pageA.getByText("当前您已是最高价")).toBeVisible();

    await pageB.getByTestId("increase-bid").click();
    await pageB.getByTestId("bid-button").click();
    await expect(pageA.getByTestId("current-price")).toHaveText("¥149.00");
    await expect(pageA.getByTestId("notice")).toContainText("已被超越");
    await expect(pageA.getByText("去支付")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("live room shows passed result without a payment link", async ({ page, request }) => {
  const demo = await apiGet<DemoContextResponse>(request, "/api/demo/context");
  const suffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`;
  const title = `E2E流拍展示商品 ${suffix}`;
  const started = await createAuctionFixture(request, demo.room.id, title, {
    start: true,
    ceilingPrice: null,
    endMsFromNow: 1_000
  });

  await page.waitForTimeout(1_300);
  await page.goto(`/live/${demo.room.id}?auctionId=${started.auction.id}`);

  await expect(page.locator(".passed-result")).toContainText("竞拍已流拍，无人成交");
  await expect(page.getByText("去支付")).toHaveCount(0);
});

test("admin publish page sends auto-extension parameters to the API", async ({ page, request }) => {
  const demo = await apiGet<DemoContextResponse>(request, "/api/demo/context");
  const suffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`;
  const title = `E2E发布延时参数商品 ${suffix}`;

  await page.goto("/admin/auctions/new");
  await page.getByLabel("商品标题").fill(title);
  await page.getByLabel("商品图片 URL").fill("https://example.com/e2e-extension.png");
  await page.getByLabel("封顶价").fill("");
  await page.getByLabel("延时触发阈值秒").fill("6");
  await page.getByLabel("每次延长秒数").fill("13");
  const createButton = page.getByRole("button", { name: "创建", exact: true });
  await expect(createButton).toBeEnabled();
  await createButton.click();

  const resultPanel = page.locator(".result-panel");
  await expect(resultPanel).toContainText("延时 6s / +13s");
  const resultText = (await resultPanel.textContent()) ?? "";
  const auctionId = Number(resultText.match(/竞拍 #(\d+)/)?.[1] ?? 0);
  expect(auctionId).toBeGreaterThan(0);
  await expect(resultPanel.getByRole("link", { name: "进入直播间" })).toHaveAttribute(
    "href",
    `/live/${demo.room.id}?auctionId=${auctionId}`
  );
  for (const bidder of demo.bidders) {
    await expect(resultPanel.getByRole("link", { name: bidder.nickname })).toHaveAttribute(
      "href",
      `/live/${demo.room.id}?userId=${bidder.id}`
    );
  }

  const detail = await apiGet<AuctionDetailResponse>(request, `/api/auctions/${auctionId}`);
  expect(detail.auction.extendThresholdSec).toBe(6);
  expect(detail.auction.extendDurationSec).toBe(13);
});

test("admin can edit scheduled auction rules from the list page", async ({ page, request }) => {
  const demo = await apiGet<DemoContextResponse>(request, "/api/demo/context");
  const suffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`;
  const title = `E2E编辑未开始规则商品 ${suffix}`;
  const scheduled = await createAuctionFixture(request, demo.room.id, title, {
    start: false,
    ceilingPrice: 299,
    extendThresholdSec: 10,
    extendDurationSec: 15
  });
  const auctionId = scheduled.auction.id;

  await page.goto("/admin/auctions");
  const row = page.locator(".table-row", { hasText: `#${auctionId}` });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "编辑" }).click();
  await expect(page.getByRole("heading", { name: "编辑竞拍规则" })).toBeVisible();
  await expect(page.getByLabel("起拍价")).toHaveValue("99");

  await page.getByLabel("起拍价").fill("130");
  await page.getByLabel("加价幅度").fill("20");
  await page.getByLabel("封顶价").fill("");
  await page.getByLabel("延时触发阈值秒").fill("8");
  await page.getByLabel("每次延长秒数").fill("16");
  await page.getByRole("button", { name: "保存规则" }).click();
  await expect(page.getByText("规则已保存")).toBeVisible();

  const detail = await apiGet<AuctionDetailResponse>(request, `/api/auctions/${auctionId}`);
  expect(detail.auction.status).toBe("Scheduled");
  expect(detail.auction.startPrice).toBe(130);
  expect(detail.auction.currentPrice).toBe(130);
  expect(detail.auction.incrementStep).toBe(20);
  expect(detail.auction.ceilingPrice).toBeNull();
  expect(detail.auction.extendThresholdSec).toBe(8);
  expect(detail.auction.extendDurationSec).toBe(16);
});
