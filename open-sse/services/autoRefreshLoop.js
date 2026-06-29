/**
 * Auto-refresh min-heap loop (Phase 7)
 * Proactive token refresh ordered by nextRefreshAt timestamp.
 * Ported from CLIProxyAPI sdk/cliproxy/auth/auto_refresh_loop.go
 *
 * Usage:
 *   import { autoRefreshLoop } from "./autoRefreshLoop.js";
 *   autoRefreshLoop.register({ id, provider, credentials, getNextRefreshAt, doRefresh });
 *   autoRefreshLoop.start();
 *   autoRefreshLoop.wake(); // call after credentials updated
 */

const REFRESH_CONCURRENCY = 16;
const REFRESH_INEFFECTIVE_BACKOFF_MS = 30_000; // if refresh returns same token
const REFRESH_FAILURE_BACKOFF_MS = 5 * 60_000; // on error
const REFRESH_CHECK_INTERVAL_MS = 5_000;       // fallback poll

// ── MinHeap ────────────────────────────────────────────────────────────────

class RefreshMinHeap {
  constructor() { this.items = []; }

  _cmp(a, b) { return a.nextRefreshAt - b.nextRefreshAt; }

  push(item) {
    this.items.push(item);
    this._siftUp(this.items.length - 1);
  }

  pop() {
    if (this.items.length === 0) return null;
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this._siftDown(0);
    }
    return top;
  }

  peek() { return this.items[0] ?? null; }
  size() { return this.items.length; }

  // Update existing item by id or push new
  upsert(item) {
    const idx = this.items.findIndex(i => i.id === item.id);
    if (idx >= 0) {
      this.items[idx] = item;
      this._siftUp(idx);
      this._siftDown(idx);
    } else {
      this.push(item);
    }
  }

  _siftUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._cmp(this.items[i], this.items[parent]) < 0) {
        [this.items[i], this.items[parent]] = [this.items[parent], this.items[i]];
        i = parent;
      } else break;
    }
  }

  _siftDown(i) {
    const n = this.items.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this._cmp(this.items[l], this.items[smallest]) < 0) smallest = l;
      if (r < n && this._cmp(this.items[r], this.items[smallest]) < 0) smallest = r;
      if (smallest === i) break;
      [this.items[i], this.items[smallest]] = [this.items[smallest], this.items[i]];
      i = smallest;
    }
  }
}

// ── AutoRefreshLoop ────────────────────────────────────────────────────────

class AutoRefreshLoop {
  constructor() {
    this.heap = new RefreshMinHeap();
    this.entries = new Map();     // id → entry metadata
    this.ineffBackoffs = new Map(); // id → nextRetryAt
    this._wakeResolve = null;
    this._running = false;
    this._timer = null;
  }

  /**
   * Register a credential for proactive refresh.
   * @param {{ id, provider, getNextRefreshAt(): number, doRefresh(): Promise<{accessToken}|null> }} entry
   */
  register(entry) {
    if (!entry?.id || !entry.doRefresh) return;
    this.entries.set(entry.id, entry);
    const nextAt = entry.getNextRefreshAt?.() ?? (Date.now() + REFRESH_CHECK_INTERVAL_MS);
    this.heap.upsert({ id: entry.id, nextRefreshAt: nextAt });
    this.wake();
  }

  unregister(id) {
    this.entries.delete(id);
    this.ineffBackoffs.delete(id);
    // Remove from heap (lazy: will be skipped when popped)
  }

  wake() {
    if (this._wakeResolve) { this._wakeResolve(); this._wakeResolve = null; }
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._loop().catch(() => {});
  }

  stop() { this._running = false; this.wake(); }

  async _loop() {
    while (this._running) {
      const next = this.heap.peek();
      const waitMs = next
        ? Math.max(0, next.nextRefreshAt - Date.now())
        : REFRESH_CHECK_INTERVAL_MS;

      await Promise.race([
        new Promise(r => { this._wakeResolve = r; }),
        new Promise(r => { this._timer = setTimeout(r, waitMs); }),
      ]);
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      if (!this._running) break;

      await this._processDue();
    }
  }

  async _processDue() {
    const due = [];
    const now = Date.now();
    while (this.heap.peek()?.nextRefreshAt <= now) {
      const item = this.heap.pop();
      if (item && this.entries.has(item.id)) due.push(item);
    }
    if (due.length === 0) return;

    // Process with concurrency cap
    for (let i = 0; i < due.length; i += REFRESH_CONCURRENCY) {
      await Promise.all(due.slice(i, i + REFRESH_CONCURRENCY).map(item => this._refreshOne(item)));
    }
  }

  async _refreshOne(item) {
    const entry = this.entries.get(item.id);
    if (!entry) return;

    // Check ineffective backoff
    const backoffUntil = this.ineffBackoffs.get(item.id);
    if (backoffUntil && Date.now() < backoffUntil) {
      this.heap.upsert({ id: item.id, nextRefreshAt: backoffUntil });
      return;
    }

    let prevToken;
    try {
      prevToken = entry.credentials?.accessToken;
      const result = await entry.doRefresh();

      if (!result) {
        // Null result — schedule retry with failure backoff
        this.heap.upsert({ id: item.id, nextRefreshAt: Date.now() + REFRESH_FAILURE_BACKOFF_MS });
        return;
      }

      // Ineffective check: token didn't change
      if (result.accessToken && result.accessToken === prevToken) {
        this.ineffBackoffs.set(item.id, Date.now() + REFRESH_INEFFECTIVE_BACKOFF_MS);
        this.heap.upsert({ id: item.id, nextRefreshAt: Date.now() + REFRESH_INEFFECTIVE_BACKOFF_MS });
        return;
      }

      this.ineffBackoffs.delete(item.id);
      const nextAt = entry.getNextRefreshAt?.() ?? (Date.now() + 55 * 60_000);
      this.heap.upsert({ id: item.id, nextRefreshAt: nextAt });
    } catch {
      this.heap.upsert({ id: item.id, nextRefreshAt: Date.now() + REFRESH_FAILURE_BACKOFF_MS });
    }
  }
}

export const autoRefreshLoop = new AutoRefreshLoop();
export { RefreshMinHeap };
