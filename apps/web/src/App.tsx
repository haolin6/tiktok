import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  AuctionDto,
  AuctionDetailResponse,
  AuctionListResponse,
  AuctionSnapshotResponse,
  AnyRealtimeServerEvent,
  BidDto,
  CancelAuctionResponse,
  CreateAuctionResponse,
  CreateProductResponse,
  DemoContextResponse,
  OrderDetailResponse,
  OrderListResponse,
  OrderSummaryDto,
  PlaceBidResponse,
  UpdateAuctionResponse,
  UserBidListResponse,
  UserDto,
  UserOrderListResponse
} from "@live-auction/shared";

interface ApiOptions {
  method?: string;
  body?: unknown;
}

interface NewAuctionForm {
  title: string;
  imageUrl: string;
  description: string;
  startPrice: string;
  incrementStep: string;
  ceilingPrice: string;
  durationSec: string;
  extendThresholdSec: string;
  extendDurationSec: string;
}

interface AuctionRulesForm {
  startPrice: string;
  incrementStep: string;
  ceilingPrice: string;
  startAt: string;
  endAt: string;
  extendThresholdSec: string;
  extendDurationSec: string;
}

type NoticeTone = "success" | "outbid" | "extension" | "settled" | "info";

interface LiveNotice {
  message: string;
  tone: NoticeTone;
}

const terminalStatuses = new Set(["Sold", "Passed", "Canceled"]);

async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? "GET"
  };

  if (options.body !== undefined) {
    init.headers = {
      "content-type": "application/json"
    };
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error
        ? String(payload.error.message)
        : `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }

  return `¥${value.toFixed(2)}`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function remainingMilliseconds(
  snapshot: AuctionSnapshotResponse,
  receivedAtMs = Date.now(),
  nowMs = Date.now()
): number {
  if (snapshot.auction.status !== "Running") {
    return 0;
  }

  const end = new Date(snapshot.auction.endAt).getTime();
  const server = new Date(snapshot.serverTime).getTime();
  const correctedServerNow = server + Math.max(0, nowMs - receivedAtMs);
  return Math.max(0, end - correctedServerNow);
}

function formatRemainingTime(valueMs: number): string {
  const totalTenths = Math.max(0, Math.ceil(valueMs / 100));
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;

  if (minutes > 0) {
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }

  return `${seconds}.${tenths}s`;
}

function toDatetimeLocalValue(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDatetimeLocalValue(value: string): string {
  return new Date(value).toISOString();
}

function getStatusLabel(status: AuctionDto["status"]): string {
  const labels: Record<AuctionDto["status"], string> = {
    Draft: "草稿",
    Scheduled: "未开始",
    Running: "竞拍中",
    Sold: "已成交",
    Passed: "已流拍",
    Canceled: "已取消"
  };

  return labels[status];
}

function selectAuctionForRoom(
  items: AuctionDto[],
  roomId: number,
  currentAuction: AuctionDto | null = null
): AuctionDto | null {
  const candidates = items.filter((item) => item.roomId === roomId);

  const running = candidates
    .filter((item) => item.status === "Running")
    .sort((left, right) => right.id - left.id)[0];
  if (running) {
    return running;
  }

  const latest = [...candidates].sort((left, right) => right.id - left.id)[0] ?? null;
  if (currentAuction) {
    const current = candidates.find((item) => item.id === currentAuction.id);
    if (current) {
      if (latest && latest.id > current.id && terminalStatuses.has(latest.status)) {
        return latest;
      }
      return current;
    }
  }

  return latest;
}

function liveAuctionHref(auction: Pick<AuctionDto, "id" | "roomId">, userId?: number): string {
  const params = new URLSearchParams({ auctionId: String(auction.id) });
  if (userId !== undefined) {
    params.set("userId", String(userId));
  }

  return `/live/${auction.roomId}?${params.toString()}`;
}

function liveUserHref(roomId: number, userId: number): string {
  return `/live/${roomId}?userId=${userId}`;
}

function realtimeUrl(): string {
  const protocol = window.location.protocol;
  const host =
    window.location.port === "3000"
      ? `${window.location.hostname}:4000`
      : window.location.host;
  return `${protocol}//${host}`;
}

function isImageMediaUrl(value: string): boolean {
  return /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(value);
}

function useDemoContext() {
  const [demo, setDemo] = useState<DemoContextResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api<DemoContextResponse>("/api/demo/context")
      .then((value) => {
        if (active) {
          setDemo(value);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (active) {
          setError(err.message);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return { demo, error };
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="app-shell">
      <nav className="top-nav">
        <a href="/admin/auctions">竞拍</a>
        <a href="/admin/auctions/new">发布</a>
        <a href="/admin/orders">订单</a>
        <a href="/me/orders">我的</a>
      </nav>
      {children}
    </main>
  );
}

function StatusPill({ status }: { status: AuctionDto["status"] }) {
  return <span className={`status-pill status-${status.toLowerCase()}`}>{getStatusLabel(status)}</span>;
}

function AdminAuctionsPage() {
  const { demo } = useDemoContext();
  const [items, setItems] = useState<AuctionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
    api<AuctionListResponse>("/api/auctions")
      .then((value) => {
        setItems(value.items);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function start(id: number) {
    setBusyId(id);
    try {
      await api<CreateAuctionResponse>(`/api/auctions/${id}/start`, { method: "POST" });
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(id: number) {
    const rawReason = window.prompt("请输入取消原因", "管理端取消");
    if (rawReason === null) {
      return;
    }

    const reason = rawReason.trim();
    if (!reason) {
      setError("取消原因不能为空");
      return;
    }

    setBusyId(id);
    try {
      await api<CancelAuctionResponse>(`/api/auctions/${id}/cancel`, {
        method: "POST",
        body: { reason }
      });
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PageShell>
      <section className="page-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>竞拍管理</h1>
        </div>
        <a className="primary-link" href="/admin/auctions/new">
          新建竞拍
        </a>
      </section>
      {error ? <div className="alert">{error}</div> : null}
      <section className="data-panel">
        <div className="table-head auctions-grid">
          <span>ID</span>
          <span>状态</span>
          <span>当前价</span>
          <span>结束时间</span>
          <span>操作</span>
        </div>
        {items.map((auction) => (
          <div className="table-row auctions-grid" key={auction.id}>
            <span>#{auction.id}</span>
            <StatusPill status={auction.status} />
            <span>{formatMoney(auction.currentPrice)}</span>
            <span>{formatTime(auction.endAt)}</span>
            <div className="row-actions">
              {auction.status === "Scheduled" ? (
                <button disabled={busyId === auction.id} onClick={() => start(auction.id)}>
                  开始
                </button>
              ) : null}
              {auction.status === "Scheduled" ? (
                <a href={`/admin/auctions/${auction.id}/edit`}>编辑</a>
              ) : null}
              {!terminalStatuses.has(auction.status) ? (
                <button
                  aria-label={`取消竞拍 #${auction.id}`}
                  className="danger-button"
                  disabled={busyId === auction.id}
                  onClick={() => cancel(auction.id)}
                >
                  取消
                </button>
              ) : null}
              <a href={liveAuctionHref(auction)}>直播间</a>
              {demo?.room.id === auction.roomId ? <span className="muted">Demo</span> : null}
            </div>
          </div>
        ))}
        {items.length === 0 ? <p className="empty">暂无竞拍</p> : null}
      </section>
    </PageShell>
  );
}

function NewAuctionPage() {
  const { demo, error: demoError } = useDemoContext();
  const [form, setForm] = useState<NewAuctionForm>({
    title: "节点2演示商品",
    imageUrl: "https://images.unsplash.com/photo-1511499767150-a48a237f0083?w=900",
    description: "30 秒演示竞拍",
    startPrice: "99",
    incrementStep: "10",
    ceilingPrice: "129",
    durationSec: "30",
    extendThresholdSec: "10",
    extendDurationSec: "15"
  });
  const [created, setCreated] = useState<CreateAuctionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function updateField(field: keyof NewAuctionForm, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function submit(startImmediately: boolean) {
    if (!demo) {
      setError("Demo context is not ready.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const product = await api<CreateProductResponse>("/api/products", {
        method: "POST",
        body: {
          title: form.title.trim(),
          imageUrl: form.imageUrl.trim() || null,
          description: form.description.trim() || null
        }
      });
      const now = Date.now();
      const durationMs = Math.max(5, Number(form.durationSec)) * 1000;
      const auction = await api<CreateAuctionResponse>("/api/auctions", {
        method: "POST",
        body: {
          roomId: demo.room.id,
          productId: product.product.id,
          startPrice: Number(form.startPrice),
          incrementStep: Number(form.incrementStep),
          ceilingPrice: form.ceilingPrice.trim() ? Number(form.ceilingPrice) : null,
          startAt: new Date(now - 1_000).toISOString(),
          endAt: new Date(now + durationMs).toISOString(),
          extendThresholdSec: Number(form.extendThresholdSec),
          extendDurationSec: Number(form.extendDurationSec)
        }
      });

      const finalAuction = startImmediately
        ? await api<CreateAuctionResponse>(`/api/auctions/${auction.auction.id}/start`, {
            method: "POST"
          })
        : auction;
      setCreated(finalAuction);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <section className="page-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>发布竞拍</h1>
        </div>
        <a className="secondary-link" href="/admin/auctions">
          返回列表
        </a>
      </section>
      {demoError || error ? <div className="alert">{demoError ?? error}</div> : null}
      <section className="form-grid">
        <label>
          商品标题
          <input value={form.title} onChange={(event) => updateField("title", event.target.value)} />
        </label>
        <label>
          商品图片 URL
          <input
            value={form.imageUrl}
            onChange={(event) => updateField("imageUrl", event.target.value)}
          />
        </label>
        <label className="wide">
          商品介绍
          <textarea
            value={form.description}
            onChange={(event) => updateField("description", event.target.value)}
          />
        </label>
        <label>
          起拍价
          <input
            inputMode="decimal"
            value={form.startPrice}
            onChange={(event) => updateField("startPrice", event.target.value)}
          />
        </label>
        <label>
          加价幅度
          <input
            inputMode="decimal"
            value={form.incrementStep}
            onChange={(event) => updateField("incrementStep", event.target.value)}
          />
        </label>
        <label>
          封顶价
          <input
            inputMode="decimal"
            value={form.ceilingPrice}
            onChange={(event) => updateField("ceilingPrice", event.target.value)}
          />
        </label>
        <label>
          时长秒
          <input
            inputMode="numeric"
            value={form.durationSec}
            onChange={(event) => updateField("durationSec", event.target.value)}
          />
        </label>
        <label>
          延时触发阈值秒
          <input
            inputMode="numeric"
            value={form.extendThresholdSec}
            onChange={(event) => updateField("extendThresholdSec", event.target.value)}
          />
        </label>
        <label>
          每次延长秒数
          <input
            inputMode="numeric"
            value={form.extendDurationSec}
            onChange={(event) => updateField("extendDurationSec", event.target.value)}
          />
        </label>
      </section>
      <div className="action-bar">
        <button disabled={busy || !demo} onClick={() => submit(false)}>
          创建
        </button>
        <button className="primary-button" disabled={busy || !demo} onClick={() => submit(true)}>
          创建并开始
        </button>
      </div>
      {created ? (
        <section className="result-panel">
          <strong>竞拍 #{created.auction.id}</strong>
          <StatusPill status={created.auction.status} />
          <span className="muted">
            延时 {created.auction.extendThresholdSec}s / +{created.auction.extendDurationSec}s
          </span>
          <a href={liveAuctionHref(created.auction)}>进入直播间</a>
          {demo ? (
            <div className="user-entry-links">
              <span>常驻用户入口</span>
              {demo.bidders.map((bidder) => (
                <a href={liveUserHref(created.auction.roomId, bidder.id)} key={bidder.id}>
                  {bidder.nickname}
                </a>
              ))}
            </div>
          ) : null}
          <a href="/admin/orders">订单列表</a>
        </section>
      ) : null}
    </PageShell>
  );
}

function EditAuctionPage({ auctionId }: { auctionId: number }) {
  const [auction, setAuction] = useState<AuctionDto | null>(null);
  const [form, setForm] = useState<AuctionRulesForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api<AuctionDetailResponse>(`/api/auctions/${auctionId}`)
      .then((value) => {
        if (!active) {
          return;
        }
        setAuction(value.auction);
        setForm({
          startPrice: String(value.auction.startPrice),
          incrementStep: String(value.auction.incrementStep),
          ceilingPrice: value.auction.ceilingPrice === null ? "" : String(value.auction.ceilingPrice),
          startAt: toDatetimeLocalValue(value.auction.startAt),
          endAt: toDatetimeLocalValue(value.auction.endAt),
          extendThresholdSec: String(value.auction.extendThresholdSec),
          extendDurationSec: String(value.auction.extendDurationSec)
        });
        setError(null);
      })
      .catch((err: Error) => {
        if (active) {
          setError(err.message);
        }
      });

    return () => {
      active = false;
    };
  }, [auctionId]);

  function updateField(field: keyof AuctionRulesForm, value: string) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  }

  async function submit() {
    if (!form) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api<UpdateAuctionResponse>(`/api/auctions/${auctionId}`, {
        method: "PATCH",
        body: {
          startPrice: Number(form.startPrice),
          incrementStep: Number(form.incrementStep),
          ceilingPrice: form.ceilingPrice.trim() ? Number(form.ceilingPrice) : null,
          startAt: fromDatetimeLocalValue(form.startAt),
          endAt: fromDatetimeLocalValue(form.endAt),
          extendThresholdSec: Number(form.extendThresholdSec),
          extendDurationSec: Number(form.extendDurationSec)
        }
      });
      setAuction(response.auction);
      setForm({
        startPrice: String(response.auction.startPrice),
        incrementStep: String(response.auction.incrementStep),
        ceilingPrice: response.auction.ceilingPrice === null ? "" : String(response.auction.ceilingPrice),
        startAt: toDatetimeLocalValue(response.auction.startAt),
        endAt: toDatetimeLocalValue(response.auction.endAt),
        extendThresholdSec: String(response.auction.extendThresholdSec),
        extendDurationSec: String(response.auction.extendDurationSec)
      });
      setNotice("规则已保存");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <section className="page-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>编辑竞拍规则</h1>
        </div>
        <a className="secondary-link" href="/admin/auctions">
          返回列表
        </a>
      </section>
      {error ? <div className="alert">{error}</div> : null}
      {notice ? <div className="success">{notice}</div> : null}
      {auction && auction.status !== "Scheduled" ? (
        <div className="alert">只有未开始竞拍可以修改规则，当前状态为 {getStatusLabel(auction.status)}。</div>
      ) : null}
      {form ? (
        <>
          <section className="form-grid">
            <label>
              起拍价
              <input
                inputMode="decimal"
                value={form.startPrice}
                onChange={(event) => updateField("startPrice", event.target.value)}
              />
            </label>
            <label>
              加价幅度
              <input
                inputMode="decimal"
                value={form.incrementStep}
                onChange={(event) => updateField("incrementStep", event.target.value)}
              />
            </label>
            <label>
              封顶价
              <input
                inputMode="decimal"
                value={form.ceilingPrice}
                onChange={(event) => updateField("ceilingPrice", event.target.value)}
              />
            </label>
            <label>
              开始时间
              <input
                type="datetime-local"
                value={form.startAt}
                onChange={(event) => updateField("startAt", event.target.value)}
              />
            </label>
            <label>
              结束时间
              <input
                type="datetime-local"
                value={form.endAt}
                onChange={(event) => updateField("endAt", event.target.value)}
              />
            </label>
            <label>
              延时触发阈值秒
              <input
                inputMode="numeric"
                value={form.extendThresholdSec}
                onChange={(event) => updateField("extendThresholdSec", event.target.value)}
              />
            </label>
            <label>
              每次延长秒数
              <input
                inputMode="numeric"
                value={form.extendDurationSec}
                onChange={(event) => updateField("extendDurationSec", event.target.value)}
              />
            </label>
          </section>
          <div className="action-bar">
            <button className="primary-button" disabled={busy || auction?.status !== "Scheduled"} onClick={submit}>
              保存规则
            </button>
            <a className="secondary-link" href={`/live/${auction?.roomId ?? 1}?auctionId=${auctionId}`}>
              查看直播间
            </a>
          </div>
        </>
      ) : (
        <p className="empty">加载中</p>
      )}
    </PageShell>
  );
}

function AdminOrdersPage() {
  const [items, setItems] = useState<OrderSummaryDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<OrderListResponse>("/api/orders")
      .then((value) => {
        setItems(value.items);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <PageShell>
      <section className="page-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>订单列表</h1>
        </div>
        <button onClick={load}>刷新</button>
      </section>
      {error ? <div className="alert">{error}</div> : null}
      <section className="data-panel">
        <div className="table-head orders-grid">
          <span>订单</span>
          <span>商品</span>
          <span>买家</span>
          <span>金额</span>
          <span>状态</span>
          <span>操作</span>
        </div>
        {items.map((order) => (
          <div className="table-row orders-grid" key={order.id}>
            <span>#{order.id}</span>
            <span>{order.product.title}</span>
            <span>{order.buyer.nickname}</span>
            <span>{formatMoney(order.amount)}</span>
            <span>{order.status}</span>
            <a href={`/pay/${order.id}`}>支付页</a>
          </div>
        ))}
        {items.length === 0 ? <p className="empty">暂无订单</p> : null}
      </section>
    </PageShell>
  );
}

function UserPicker({
  bidders,
  value,
  onChange
}: {
  bidders: UserDto[];
  value: number | null;
  onChange: (userId: number) => void;
}) {
  return (
    <div className="segmented">
      {bidders.map((bidder) => (
        <button
          className={value === bidder.id ? "active" : ""}
          key={bidder.id}
          onClick={() => onChange(bidder.id)}
        >
          {bidder.nickname}
        </button>
      ))}
    </div>
  );
}

function LiveRoomPage({
  roomId,
  auctionId,
  initialUserId
}: {
  roomId: number;
  auctionId: number | undefined;
  initialUserId: number | undefined;
}) {
  const { demo, error: demoError } = useDemoContext();
  const [auction, setAuction] = useState<AuctionDto | null>(null);
  const [snapshot, setSnapshot] = useState<AuctionSnapshotResponse | null>(null);
  const [snapshotReceivedAt, setSnapshotReceivedAt] = useState(Date.now());
  const [ranking, setRanking] = useState<BidDto[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<LiveNotice | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "reconnecting" | "disconnected">("disconnected");
  const [onlineCount, setOnlineCount] = useState(0);
  const [clockMs, setClockMs] = useState(Date.now());
  const [reconnectTick, setReconnectTick] = useState(0);
  const auctionRef = useRef<AuctionDto | null>(null);

  const showNotice = useCallback((message: string, tone: NoticeTone = "success") => {
    setNotice({ message, tone });
  }, []);

  const applySnapshot = useCallback((value: AuctionSnapshotResponse) => {
    const previousAuctionId = auctionRef.current?.id ?? null;
    auctionRef.current = value.auction;
    setSnapshot(value);
    setSnapshotReceivedAt(Date.now());
    setAuction(value.auction);
    if (previousAuctionId !== null && previousAuctionId !== value.auction.id) {
      setRanking([]);
      setNotice(null);
    }
  }, []);

  const setActiveAuction = useCallback((value: AuctionDto | null) => {
    const previousAuctionId = auctionRef.current?.id ?? null;
    auctionRef.current = value;
    setAuction(value);
    if (!value || previousAuctionId !== value.id) {
      setSnapshot(null);
      setRanking([]);
      setNotice(null);
    }
  }, []);

  useEffect(() => {
    if (!demo || selectedUserId !== null) {
      return;
    }

    const initialUser = demo.bidders.find((bidder) => bidder.id === initialUserId) ?? demo.bidders[0];
    if (initialUser) {
      setSelectedUserId(initialUser.id);
    }
  }, [demo, initialUserId, selectedUserId]);

  const selectUser = useCallback((userId: number) => {
    setSelectedUserId(userId);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("userId", String(userId));
    window.history.replaceState(null, "", `${nextUrl.pathname}${nextUrl.search}`);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const loadAuction = useCallback(() => {
    if (auctionId) {
      api<AuctionDetailResponse>(`/api/auctions/${auctionId}`)
        .then((value) => {
          if (value.auction.roomId !== roomId) {
            throw new Error(`竞拍 #${auctionId} 不属于直播间 ${roomId}`);
          }
          setActiveAuction(value.auction);
          setError(null);
        })
        .catch((err: Error) => setError(err.message));
      return;
    }

    api<AuctionListResponse>("/api/auctions")
      .then((value) => {
        const selected = selectAuctionForRoom(value.items, roomId, auctionRef.current);
        setActiveAuction(selected);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [auctionId, roomId, setActiveAuction]);

  const loadSnapshot = useCallback((auctionId: number) => {
    api<AuctionSnapshotResponse>(`/api/auctions/${auctionId}/snapshot`)
      .then((value) => {
        applySnapshot(value);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [applySnapshot]);

  useEffect(() => {
    loadAuction();
  }, [loadAuction]);

  useEffect(() => {
    if (auctionId) {
      return;
    }

    const timer = window.setInterval(loadAuction, 3_000);
    return () => window.clearInterval(timer);
  }, [auctionId, loadAuction]);

  useEffect(() => {
    if (!auction) {
      return;
    }

    loadSnapshot(auction.id);
    const timer = window.setInterval(() => {
      if (connectionStatus !== "connected") {
        loadSnapshot(auction.id);
      }
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [auction?.id, auction?.status, connectionStatus, loadSnapshot]);

  useEffect(() => {
    if (!auction || !demo || !selectedUserId) {
      return;
    }

    let closedByEffect = false;
    let reconnectTimer = 0;
    const socket: Socket = io(realtimeUrl(), {
      transports: ["websocket"]
    });
    setConnectionStatus(reconnectTick === 0 ? "connecting" : "reconnecting");

    function send(event: string, payload: unknown): Promise<boolean> {
      return new Promise((resolve) => {
        socket.emit(event, payload, (ack: { ok: boolean; error?: { message: string } }) => {
          resolve(Boolean(ack.ok));
          if (!ack.ok && ack.error) {
            setError(ack.error.message);
          }
        });
      });
    }

    socket.on("connect", () => {
      setConnectionStatus("connected");
      socket.emit("room.join", { roomId, userId: selectedUserId }, (ack: { ok: boolean; error?: { message: string } }) => {
        if (!ack.ok && ack.error) {
          setError(ack.error.message);
          return;
        }
        void send("auction.subscribe", { auctionId: auction.id });
      });
    });

    function handleRealtimeEvent(realtimeEvent: AnyRealtimeServerEvent | undefined) {
      if (!realtimeEvent) {
        return;
      }

      if (realtimeEvent.type === "auction.snapshot") {
        applySnapshot(realtimeEvent.payload);
        setError(null);
      } else if (realtimeEvent.type === "ranking.updated") {
        setRanking(realtimeEvent.payload.ranking);
      } else if (realtimeEvent.type === "auction.extended") {
        showNotice(
          `已自动延时 ${realtimeEvent.payload.extendDurationSec}s，到 ${formatTime(realtimeEvent.payload.newEndAt)}`,
          "extension"
        );
      } else if (realtimeEvent.type === "bid.accepted") {
        const ownBid = realtimeEvent.payload.userId === selectedUserId;
        showNotice(
          ownBid
            ? `出价成功 ${formatMoney(realtimeEvent.payload.amount)}，领先中`
            : `有人出价 ${formatMoney(realtimeEvent.payload.amount)}`,
          ownBid ? "success" : "info"
        );
      } else if (realtimeEvent.type === "bid.rejected") {
        if (realtimeEvent.payload.userId === selectedUserId) {
          setError(realtimeEvent.payload.reason);
        }
      } else if (realtimeEvent.type === "order.paid") {
        showNotice(`订单 #${realtimeEvent.payload.orderId} 已支付`, "settled");
      } else if (realtimeEvent.type === "room.presence") {
        setOnlineCount(realtimeEvent.payload.onlineCount);
      } else if (realtimeEvent.type === "auction.canceled") {
        showNotice("竞拍已取消", "settled");
        loadSnapshot(realtimeEvent.payload.auctionId);
      } else if (realtimeEvent.type === "auction.sold") {
        showNotice(`竞拍成交 ${formatMoney(realtimeEvent.payload.amount)}`, "settled");
      } else if (realtimeEvent.type === "auction.passed") {
        showNotice("竞拍已流拍，无人成交", "settled");
      } else if (realtimeEvent.type === "user.outbid") {
        if (realtimeEvent.payload.previousWinnerId === selectedUserId) {
          showNotice(`已被超越，当前价 ${formatMoney(realtimeEvent.payload.amount)}`, "outbid");
        }
      }
    }

    socket.on("auction.snapshot", handleRealtimeEvent);
    socket.on("ranking.updated", handleRealtimeEvent);
    socket.on("auction.extended", handleRealtimeEvent);
    socket.on("bid.accepted", handleRealtimeEvent);
    socket.on("bid.rejected", handleRealtimeEvent);
    socket.on("order.paid", handleRealtimeEvent);
    socket.on("room.presence", handleRealtimeEvent);
    socket.on("auction.canceled", handleRealtimeEvent);
    socket.on("auction.sold", handleRealtimeEvent);
    socket.on("auction.passed", handleRealtimeEvent);
    socket.on("user.outbid", handleRealtimeEvent);

    socket.on("disconnect", () => {
      if (closedByEffect) {
        return;
      }

      setConnectionStatus("disconnected");
      reconnectTimer = window.setTimeout(() => setReconnectTick((value) => value + 1), 1_200);
    });

    socket.on("connect_error", () => {
      setConnectionStatus("disconnected");
    });

    return () => {
      closedByEffect = true;
      window.clearTimeout(reconnectTimer);
      socket.disconnect();
    };
  }, [auction?.id, applySnapshot, demo, loadSnapshot, reconnectTick, roomId, selectedUserId, showNotice]);

  async function placeBid() {
    if (!snapshot || !selectedUserId || snapshot.nextBidAmount === null) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api<PlaceBidResponse>(`/api/auctions/${snapshot.auction.id}/bids`, {
        method: "POST",
        body: {
          userId: selectedUserId,
          amount: snapshot.nextBidAmount,
          requestId: `${selectedUserId}-${snapshot.auction.id}-${Date.now()}`
        }
      });
      applySnapshot(response.snapshot);
      setAuction(response.auction);
      showNotice(`出价成功 ${formatMoney(response.bid.amount)}，领先中`);
    } catch (err) {
      setError((err as Error).message);
      if (snapshot) {
        loadSnapshot(snapshot.auction.id);
      }
    } finally {
      setBusy(false);
    }
  }

  const currentUser = useMemo(
    () => demo?.bidders.find((bidder) => bidder.id === selectedUserId) ?? null,
    [demo, selectedUserId]
  );
  const canBid =
    snapshot?.auction.status === "Running" &&
    snapshot.nextBidAmount !== null &&
    !busy &&
    selectedUserId !== null;
  const isWinner = snapshot?.order?.buyerId === selectedUserId;
  const roomMediaUrl = snapshot?.room.videoUrl ?? demo?.room.videoUrl ?? "";
  const remainingMsValue = snapshot ? remainingMilliseconds(snapshot, snapshotReceivedAt, clockMs) : 0;
  const isFinalCountdown = snapshot?.auction.status === "Running" && remainingMsValue <= 10_000;
  const currentUserLeading =
    snapshot?.auction.status === "Running" &&
    snapshot.currentWinner?.id === selectedUserId &&
    selectedUserId !== null;
  const isPassedWithoutOrder = snapshot?.auction.status === "Passed" && snapshot.order === null;

  return (
    <PageShell>
      <section className="live-shell">
        <div className="video-stage">
          {roomMediaUrl && isImageMediaUrl(roomMediaUrl) ? (
            <img className="live-media" src={roomMediaUrl} alt={snapshot?.room.title ?? demo?.room.title ?? "直播间画面"} />
          ) : roomMediaUrl ? (
            <video className="live-media" src={roomMediaUrl} muted loop autoPlay playsInline />
          ) : null}
          <div className="video-fallback">
            <span>LIVE</span>
            <strong>{snapshot?.room.title ?? demo?.room.title ?? `直播间 ${roomId}`}</strong>
          </div>
        </div>
        <aside className="auction-panel" data-testid="auction-panel">
          {demo ? (
            <UserPicker bidders={demo.bidders} value={selectedUserId} onChange={selectUser} />
          ) : null}
          <div className="connection-row">
            <span className={`connection-dot ${connectionStatus}`} />
            <strong data-testid="connection-status">{connectionStatus}</strong>
            <span>{onlineCount} 已连接用户</span>
          </div>
          {snapshot ? (
            <>
              <div className="product-line">
                {snapshot.product.imageUrl ? (
                  <img src={snapshot.product.imageUrl} alt={snapshot.product.title} />
                ) : (
                  <div className="image-placeholder" />
                )}
                <div>
                  <h1>{snapshot.product.title}</h1>
                  <StatusPill status={snapshot.auction.status} />
                </div>
              </div>
              <div className={`price-board ${currentUserLeading ? "leading" : ""}`}>
                <span>当前价</span>
                <strong data-testid="current-price">{formatMoney(snapshot.currentPrice)}</strong>
              </div>
              {currentUserLeading ? <div className="leader-strip">领先中</div> : null}
              <div className="metric-grid" data-testid="metric-grid">
                <div>
                  <span>下一口价</span>
                  <strong>{formatMoney(snapshot.nextBidAmount)}</strong>
                </div>
                <div className={isFinalCountdown ? "countdown-hot" : ""}>
                  <span>倒计时</span>
                  <strong data-testid="remaining-time">{formatRemainingTime(remainingMsValue)}</strong>
                </div>
                <div>
                  <span>领先者</span>
                  <strong data-testid="leader">{snapshot.currentWinner?.nickname ?? "-"}</strong>
                </div>
                <div>
                  <span>当前用户</span>
                  <strong>{currentUser?.nickname ?? "-"}</strong>
                </div>
                <div>
                  <span>延时规则</span>
                  <strong>{snapshot.auction.extendThresholdSec}s / +{snapshot.auction.extendDurationSec}s</strong>
                </div>
              </div>
              <button className="bid-button" data-testid="bid-button" disabled={!canBid} onClick={placeBid}>
                {snapshot.nextBidAmount === null ? "不可出价" : `出价 ${formatMoney(snapshot.nextBidAmount)}`}
              </button>
              {notice ? <div className={`notice ${notice.tone}`} data-testid="notice">{notice.message}</div> : null}
              {snapshot.order ? (
                <div className="result-panel compact">
                  <strong>{snapshot.auction.status === "Sold" ? "成交" : "结果"}</strong>
                  <span>{formatMoney(snapshot.order.amount)}</span>
                  {isWinner ? <a href={`/pay/${snapshot.order.id}`}>去支付</a> : <span>未成交</span>}
                </div>
              ) : isPassedWithoutOrder ? (
                <div className="result-panel compact passed-result">
                  <strong>竞拍已流拍，无人成交</strong>
                  <span>本场没有成交订单</span>
                </div>
              ) : null}
              <div className="bid-list">
                <h2>最近出价</h2>
                {snapshot.recentBids.map((bid) => (
                  <div key={bid.id}>
                    <span>{bid.user?.nickname ?? `用户 ${bid.userId}`}</span>
                    <strong>{formatMoney(bid.amount)}</strong>
                  </div>
                ))}
                {snapshot.recentBids.length === 0 ? <p className="empty small">暂无出价</p> : null}
              </div>
              <div className="bid-list">
                <h2>排行榜</h2>
                {(ranking.length > 0 ? ranking : snapshot.recentBids).slice(0, 5).map((bid, index) => (
                  <div key={`rank-${bid.id}`}>
                    <span>#{index + 1} {bid.user?.nickname ?? `用户 ${bid.userId}`}</span>
                    <strong>{formatMoney(bid.amount)}</strong>
                  </div>
                ))}
                {ranking.length === 0 && snapshot.recentBids.length === 0 ? (
                  <p className="empty small">暂无排行</p>
                ) : null}
              </div>
            </>
          ) : (
            <div className="empty">暂无可展示竞拍</div>
          )}
          {demoError || error ? <div className="alert">{demoError ?? error}</div> : null}
        </aside>
      </section>
    </PageShell>
  );
}

function PayPage({ orderId }: { orderId: number }) {
  const [order, setOrder] = useState<OrderSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<OrderDetailResponse>(`/api/orders/${orderId}`)
      .then((value) => {
        setOrder(value.order);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const response = await api<OrderDetailResponse>(`/api/orders/${orderId}/mock-pay`, {
        method: "POST"
      });
      setOrder(response.order);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <section className="page-header">
        <div>
          <p className="eyebrow">Payment</p>
          <h1>模拟支付</h1>
        </div>
        <a className="secondary-link" href="/admin/orders">
          订单列表
        </a>
      </section>
      {error ? <div className="alert">{error}</div> : null}
      {order ? (
        <section className="pay-panel">
          <div>
            <span>商品</span>
            <strong>{order.product.title}</strong>
          </div>
          <div>
            <span>成交价</span>
            <strong>{formatMoney(order.amount)}</strong>
          </div>
          <div>
            <span>买家</span>
            <strong>{order.buyer.nickname}</strong>
          </div>
          <div>
            <span>状态</span>
            <strong>{order.status}</strong>
          </div>
          <button className="primary-button" disabled={busy || order.status === "paid"} onClick={pay}>
            {order.status === "paid" ? "已支付" : "模拟支付"}
          </button>
        </section>
      ) : null}
    </PageShell>
  );
}

function MyOrdersPage() {
  const { demo, error: demoError } = useDemoContext();
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [orders, setOrders] = useState<OrderSummaryDto[]>([]);
  const [bids, setBids] = useState<UserBidListResponse["items"]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (demo && selectedUserId === null && demo.bidders[0]) {
      setSelectedUserId(demo.bidders[0].id);
    }
  }, [demo, selectedUserId]);

  useEffect(() => {
    if (!selectedUserId) {
      return;
    }

    Promise.all([
      api<UserOrderListResponse>(`/api/me/orders?userId=${selectedUserId}`),
      api<UserBidListResponse>(`/api/me/bids?userId=${selectedUserId}`)
    ])
      .then(([orderValue, bidValue]) => {
        setOrders(orderValue.items);
        setBids(bidValue.items);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [selectedUserId]);

  return (
    <PageShell>
      <section className="page-header">
        <div>
          <p className="eyebrow">User</p>
          <h1>我的竞拍</h1>
        </div>
      </section>
      {demo ? (
        <UserPicker bidders={demo.bidders} value={selectedUserId} onChange={setSelectedUserId} />
      ) : null}
      {demoError || error ? <div className="alert">{demoError ?? error}</div> : null}
      <section className="split-panels">
        <div className="data-panel">
          <h2>我的订单</h2>
          {orders.map((order) => (
            <div className="history-row" key={order.id}>
              <span>{order.product.title}</span>
              <strong>{formatMoney(order.amount)}</strong>
              <a href={`/pay/${order.id}`}>{order.status}</a>
            </div>
          ))}
          {orders.length === 0 ? <p className="empty small">暂无订单</p> : null}
        </div>
        <div className="data-panel">
          <h2>我的出价</h2>
          {bids.map((bid) => (
            <div className="history-row" key={bid.id}>
              <span>竞拍 #{bid.auctionId}</span>
              <strong>{formatMoney(bid.amount)}</strong>
              <span>{bid.accepted ? "成功" : bid.rejectReason ?? "失败"}</span>
            </div>
          ))}
          {bids.length === 0 ? <p className="empty small">暂无出价</p> : null}
        </div>
      </section>
    </PageShell>
  );
}

export function App() {
  const segments = window.location.pathname.split("/").filter(Boolean);

  if (segments[0] === "admin" && segments[1] === "auctions" && segments[2] === "new") {
    return <NewAuctionPage />;
  }

  if (segments[0] === "admin" && segments[1] === "auctions" && segments[3] === "edit") {
    const auctionId = Number(segments[2]);
    return <EditAuctionPage auctionId={Number.isInteger(auctionId) && auctionId > 0 ? auctionId : 1} />;
  }

  if (segments[0] === "admin" && segments[1] === "orders") {
    return <AdminOrdersPage />;
  }

  if (segments[0] === "admin" && segments[1] === "auctions") {
    return <AdminAuctionsPage />;
  }

  if (segments[0] === "live") {
    const roomId = Number(segments[1]);
    const auctionId = Number(new URLSearchParams(window.location.search).get("auctionId"));
    const userId = Number(new URLSearchParams(window.location.search).get("userId"));
    return (
      <LiveRoomPage
        roomId={Number.isInteger(roomId) && roomId > 0 ? roomId : 1}
        auctionId={Number.isInteger(auctionId) && auctionId > 0 ? auctionId : undefined}
        initialUserId={Number.isInteger(userId) && userId > 0 ? userId : undefined}
      />
    );
  }

  if (segments[0] === "pay") {
    const orderId = Number(segments[1]);
    return <PayPage orderId={Number.isInteger(orderId) && orderId > 0 ? orderId : 1} />;
  }

  if (segments[0] === "me" && segments[1] === "orders") {
    return <MyOrdersPage />;
  }

  return <AdminAuctionsPage />;
}
