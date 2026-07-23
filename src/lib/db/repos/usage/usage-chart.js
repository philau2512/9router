/**
 * Chart data generation — time-series bucketing for usage visualization.
 *
 * Supports daily, 24h, 7d, 30d, 60d, 90d, 180d, 365d, and all-time periods with hourly or daily buckets.
 */

import { getAdapter } from "../../driver.js";
import { parseJson } from "../../helpers/jsonCol.js";
import { PERIOD_MS } from "./usage-state.js";
import { loadDaysInRange } from "./usage-helpers.js";

function buildHourlyBuckets(startTime, bucketCount, bucketMs) {
  const labelFn = (ts) =>
    new Date(ts).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return Array.from({ length: bucketCount }, (_, i) => ({
    label: labelFn(startTime + i * bucketMs),
    tokens: 0,
    cost: 0,
  }));
}

export async function getChartData(period = "7d", connectionId) {
  const db = await getAdapter();
  const now = Date.now();

  // --- Today: hourly buckets from start of day ---
  if (period === "today") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startTime = startOfDay.getTime();
    const endTime = startTime + bucketCount * bucketMs;
    const buckets = buildHourlyBuckets(startTime, bucketCount, bucketMs);

    const rows = connectionId
      ? db.all(
          `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE connectionId = ? AND timestamp >= ?`,
          [connectionId, new Date(startTime).toISOString()],
        )
      : db.all(
          `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ?`,
          [new Date(startTime).toISOString()],
        );
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t >= endTime) continue;
      const idx = Math.floor((t - startTime) / bucketMs);
      if (idx >= 0 && idx < bucketCount) {
        buckets[idx].tokens +=
          (r.promptTokens || 0) + (r.completionTokens || 0);
        buckets[idx].cost += r.cost || 0;
      }
    }
    return buckets;
  }

  // --- 24h: hourly buckets from now ---
  if (period === "24h") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const startTime = now - bucketCount * bucketMs;
    const buckets = buildHourlyBuckets(startTime, bucketCount, bucketMs);

    const rows = connectionId
      ? db.all(
          `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE connectionId = ? AND timestamp >= ?`,
          [connectionId, new Date(startTime).toISOString()],
        )
      : db.all(
          `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ?`,
          [new Date(startTime).toISOString()],
        );
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t > now) continue;
      const idx = Math.min(
        Math.floor((t - startTime) / bucketMs),
        bucketCount - 1,
      );
      buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
      buckets[idx].cost += r.cost || 0;
    }
    return buckets;
  }

  if (connectionId) {
    const periodDays = {
      "7d": 7,
      "30d": 30,
      "60d": 60,
      "90d": 90,
      "180d": 180,
      "365d": 365,
    };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const firstTimestamp = db.get(
      `SELECT MIN(timestamp) AS timestamp FROM usageHistory WHERE connectionId = ?`,
      [connectionId],
    )?.timestamp;
    const firstDay = firstTimestamp ? new Date(firstTimestamp) : today;
    firstDay.setHours(0, 0, 0, 0);
    const bucketCount = periodDays[period]
      ? periodDays[period]
      : Math.max(
          1,
          Math.floor((today.getTime() - firstDay.getTime()) / 86400000) + 1,
        );
    const startDay = new Date(today);
    startDay.setDate(startDay.getDate() - bucketCount + 1);
    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE connectionId = ? AND timestamp >= ?`,
      [connectionId, startDay.toISOString()],
    );
    const byDate = new Map();
    for (const row of rows) {
      const date = new Date(row.timestamp);
      const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const bucket = byDate.get(dateKey) || { tokens: 0, cost: 0 };
      bucket.tokens += (row.promptTokens || 0) + (row.completionTokens || 0);
      bucket.cost += row.cost || 0;
      byDate.set(dateKey, bucket);
    }
    const labelFn = (date) =>
      date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return Array.from({ length: bucketCount }, (_, index) => {
      const date = new Date(startDay);
      date.setDate(date.getDate() + index);
      const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const bucket = byDate.get(dateKey) || { tokens: 0, cost: 0 };
      return { label: labelFn(date), ...bucket };
    });
  }

  // --- 7d / 30d / 60d / 90d / 180d / 365d / all: daily buckets from usageDaily ---
  let bucketCount;
  if (period === "7d") bucketCount = 7;
  else if (period === "30d") bucketCount = 30;
  else if (period === "60d") bucketCount = 60;
  else if (period === "90d") bucketCount = 90;
  else if (period === "180d") bucketCount = 180;
  else if (period === "365d") bucketCount = 365;
  else {
    // "all" — load all available days from usageDaily
    const allRows = db.all(
      `SELECT dateKey FROM usageDaily ORDER BY dateKey ASC`,
    );
    bucketCount = allRows.length || 1;
  }
  const today = new Date();
  const labelFn = (d) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const dayRows = loadDaysInRange(db, bucketCount);
  const dayMap = {};
  for (const r of dayRows) dayMap[r.dateKey] = parseJson(r.data, {});

  return Array.from({ length: bucketCount }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (bucketCount - 1 - i));
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayData = dayMap[dateKey];
    return {
      label: labelFn(d),
      tokens: dayData
        ? (dayData.promptTokens || 0) + (dayData.completionTokens || 0)
        : 0,
      cost: dayData ? dayData.cost || 0 : 0,
    };
  });
}
