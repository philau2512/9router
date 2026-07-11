/**
 * Provider cooldown persistence — survive server restarts.
 * Atomic upsert per (provider, auth_id, model) key.
 * Writes are fire-and-forget; reads only on startup.
 */

import { getAdapter } from "../../driver.js";

const EXPIRE_AFTER_MS = 60 * 60 * 1000; // 1 hour past expiry before cleanup

/**
 * Upsert a cooldown record. Fire-and-forget safe.
 * @param {{ provider, authId, model?, nextRetryAfter, reason?, status? }} record
 */
export async function upsertCooldown({
  provider,
  authId,
  model = "",
  nextRetryAfter,
  reason = null,
  status = null,
}) {
  if (!provider || !authId || !nextRetryAfter) return;
  try {
    const db = await getAdapter();
    db.run(
      `INSERT INTO provider_cooldowns (provider, auth_id, model, next_retry_after, reason, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, auth_id, model)
       DO UPDATE SET next_retry_after = excluded.next_retry_after,
                     reason = excluded.reason,
                     status = excluded.status,
                     updated_at = excluded.updated_at`,
      [provider, authId, model, nextRetryAfter, reason, status, Date.now()],
    );
  } catch {
    // Best-effort — never block hot path
  }
}

/**
 * Delete a cooldown record when account recovers.
 */
export async function clearCooldown({ provider, authId, model = "" }) {
  if (!provider || !authId) return;
  try {
    const db = await getAdapter();
    db.run(
      `DELETE FROM provider_cooldowns WHERE provider = ? AND auth_id = ? AND model = ?`,
      [provider, authId, model],
    );
  } catch {}
}

/**
 * Load all active (not yet expired) cooldown records on startup.
 * @returns {Promise<Array<{ provider, authId, model, nextRetryAfter, reason, status }>>}
 */
export async function loadActiveCooldowns() {
  try {
    const db = await getAdapter();
    const now = Date.now();
    const rows = db.all(
      `SELECT provider, auth_id, model, next_retry_after, reason, status
       FROM provider_cooldowns
       WHERE next_retry_after > ?`,
      [now],
    );
    return rows.map((r) => ({
      provider: r.provider,
      authId: r.auth_id,
      model: r.model,
      nextRetryAfter: r.next_retry_after,
      reason: r.reason,
      status: r.status,
    }));
  } catch {
    return [];
  }
}

/**
 * Remove expired records to keep DB lean. Call on startup or periodically.
 */
export async function expireOldCooldowns() {
  try {
    const db = await getAdapter();
    const cutoff = Date.now() - EXPIRE_AFTER_MS;
    db.run(`DELETE FROM provider_cooldowns WHERE next_retry_after < ?`, [
      cutoff,
    ]);
  } catch {}
}
