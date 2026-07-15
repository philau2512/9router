/**
 * Per-request_id stream broker: backlog + subscribers + cancel.
 */
const { EventEmitter } = require("events");

class StreamBroker {
  constructor() {
    /** @type {Map<string, ActiveStream>} */
    this.streams = new Map();
  }

  getOrCreate(requestId) {
    const id = String(requestId || "").trim();
    if (!id) throw new Error("request_id required");
    let s = this.streams.get(id);
    if (!s) {
      s = new ActiveStream(id);
      this.streams.set(id, s);
    }
    return s;
  }

  get(requestId) {
    return this.streams.get(String(requestId || "").trim()) || null;
  }

  remove(requestId) {
    const s = this.streams.get(String(requestId || "").trim());
    if (s) {
      s.close();
      this.streams.delete(String(requestId || "").trim());
    }
  }
}

class ActiveStream extends EventEmitter {
  constructor(requestId) {
    super();
    this.requestId = requestId;
    this.backlog = [];
    this.closed = false;
    this.aborted = false;
    this.abortController = new AbortController();
    this.meta = {};
    this.pendingTools = new Map(); // callId -> resolve
    this.execSeq = 1;
  }

  publish(messageBuf) {
    if (this.closed) return;
    this.backlog.push(messageBuf);
    // keep backlog bounded
    if (this.backlog.length > 500) this.backlog.shift();
    this.emit("message", messageBuf);
  }

  abort() {
    this.aborted = true;
    try {
      this.abortController.abort();
    } catch {
      /* ignore */
    }
    this.emit("abort");
  }

  /** Reset abort state so the same request_id can start a new run. */
  resetForNewRun() {
    this.aborted = false;
    this.abortController = new AbortController();
    // drop pending tool waiters from previous run
    for (const [, resolver] of this.pendingTools) {
      try {
        resolver({ resultText: "[cursor-local] previous run aborted" });
      } catch {
        /* ignore */
      }
    }
    this.pendingTools.clear();
  }

  close() {
    this.closed = true;
    this.emit("close");
    this.removeAllListeners();
  }

  waitToolResult(callId, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingTools.delete(callId);
        reject(new Error(`tool timeout ${callId}`));
      }, timeoutMs);
      this.pendingTools.set(callId, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });
  }

  resolveToolResult(callId, result) {
    const fn = this.pendingTools.get(callId);
    if (fn) {
      this.pendingTools.delete(callId);
      fn(result);
      return true;
    }
    // also try by exec id match any
    for (const [k, resolver] of this.pendingTools) {
      if (k === callId || result?.execId === k) {
        this.pendingTools.delete(k);
        resolver(result);
        return true;
      }
    }
    return false;
  }
}

const globalBroker = new StreamBroker();

module.exports = { StreamBroker, ActiveStream, globalBroker };
