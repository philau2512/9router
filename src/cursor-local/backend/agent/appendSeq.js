/**
 * append_seqno dedup tracker — mirrors byok AppendSeqTracker.
 * Rejects stale/duplicate seq; avoids replay bugs on network retry.
 */
const RETENTION_MS = 10 * 60 * 1000;

class AppendSeqTracker {
  constructor() {
    this._states = new Map();
    this._lastClean = Date.now();
  }

  /**
   * Returns { stale: bool } — stale=true means ignore this append.
   * seq=0 is always accepted (prewarm/metadata).
   */
  check(requestId, seq) {
    const id = String(requestId || "").trim();
    if (!id || seq <= 0) return { stale: false };
    this._maybeClean();
    let st = this._states.get(id);
    if (!st) {
      st = { next: 1, updatedAt: Date.now() };
      this._states.set(id, st);
    }
    st.updatedAt = Date.now();
    if (seq < st.next) return { stale: true };
    if (seq === st.next) {
      st.next++;
      return { stale: false };
    }
    // seq > next: out-of-order but accept (byok also skips gaps)
    st.next = seq + 1;
    return { stale: false };
  }

  remove(requestId) {
    this._states.delete(String(requestId || "").trim());
  }

  _maybeClean() {
    const now = Date.now();
    if (now - this._lastClean < RETENTION_MS) return;
    this._lastClean = now;
    const cutoff = now - RETENTION_MS;
    for (const [k, v] of this._states) {
      if (v.updatedAt < cutoff) this._states.delete(k);
    }
  }
}

const globalSeqTracker = new AppendSeqTracker();
module.exports = { AppendSeqTracker, globalSeqTracker };
