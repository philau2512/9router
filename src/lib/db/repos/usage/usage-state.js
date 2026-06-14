/**
 * Global in-memory state for usage tracking.
 *
 * Shared across Next.js modules via globalThis to survive HMR
 * and module re-evaluation in dev mode.
 */

import { EventEmitter } from "events";

// --- Constants ---
export const PENDING_TIMEOUT_MS = 60 * 1000;
export const RING_CAP = 50;
export const CONN_CACHE_TTL_MS = 30 * 1000;
export const PERIOD_MS = {
  "24h": 86400000,
  "7d": 604800000,
  "30d": 2592000000,
  "60d": 5184000000,
};

// --- Global state initialization ---
if (!global._pendingRequests)
  global._pendingRequests = { byModel: {}, byAccount: {} };
if (!global._lastErrorProvider)
  global._lastErrorProvider = { provider: "", ts: 0 };
if (!global._statsEmitter) {
  global._statsEmitter = new EventEmitter();
  global._statsEmitter.setMaxListeners(50);
}
if (!global._pendingTimers) global._pendingTimers = {};
if (!global._recentRing) global._recentRing = { items: [], initialized: false };
if (!global._connectionMapCache)
  global._connectionMapCache = { map: {}, ts: 0 };

export const pendingRequests = global._pendingRequests;
export const lastErrorProvider = global._lastErrorProvider;
export const pendingTimers = global._pendingTimers;
export const recentRing = global._recentRing;
export const connCache = global._connectionMapCache;
export const statsEmitter = global._statsEmitter;

// --- Debounced emitters to prevent event flood under high concurrency ---
const EMIT_DEBOUNCE_MS = 150;
let _pendingTimer = null;
let _updateTimer = null;

export function emitPending() {
  if (_pendingTimer) return;
  _pendingTimer = setTimeout(() => {
    _pendingTimer = null;
    statsEmitter.emit("pending");
  }, EMIT_DEBOUNCE_MS);
}

export function emitUpdate() {
  if (_updateTimer) return;
  _updateTimer = setTimeout(() => {
    _updateTimer = null;
    statsEmitter.emit("update");
  }, EMIT_DEBOUNCE_MS);
}

// --- Ring buffer ---

export function pushToRing(entry) {
  recentRing.items.push(entry);
  if (recentRing.items.length > RING_CAP) {
    recentRing.items = recentRing.items.slice(-RING_CAP);
  }
}
