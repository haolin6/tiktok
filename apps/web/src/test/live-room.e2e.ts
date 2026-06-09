import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type {
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
  const product = await apiPost<CreateProductResponse>(request, "/api/products", {
    title,
    imageUrl: "https://example.com/e2e-product.png",
    description: "Created by Playwright live-room E2E."
  });
  const now = Date.now();
  const auction = await apiPost<CreateAuctionResponse>(request, "/api/auctions", {
    roomId,
    productId: product.product.id,
    startPrice: 99,
    incrementStep: 10,
    ceilingPrice: 119,
    startAt: new Date(now - 1_000).toISOString(),
    endAt: new Date(now + 60_000).toISOString(),
    extendThresholdSec: 10,
    extendDurationSec: 15
  });

  return apiPost<CreateAuctionResponse>(request, `/api/auctions/${auction.auction.id}/start`);
}

async function openLiveRoom(
  page: Page,
  roomId: number,
  title: string,
  userButtonName?: string
): Promise<void> {
  await page.goto(`/live/${roomId}`);
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
    await openLiveRoom(pageA, demo.room.id, title, demo.bidders[0]?.nickname);
    await openLiveRoom(pageB, demo.room.id, title, demo.bidders[1]?.nickname);

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
    await expect(pageA.getByTestId("bid-button")).toBeVisible();
    const layout = await pageA.evaluate(() => {
      const documentElement = document.documentElement;
      const viewportWidth = documentElement.clientWidth;
      const selectors = [
        "[data-testid='auction-panel']",
        "[data-testid='metric-grid']",
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
