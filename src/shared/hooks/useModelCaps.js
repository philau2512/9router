"use client";

import { useState, useEffect } from "react";

/**
 * Fetch model capabilities from /api/models and expose a lookup by model key.
 * API-driven (no registry dependency) — capabilities come from the server's
 * /api/models response which includes per-model `caps` fields.
 *
 * Note: full reorderByCapabilities (combo autoswitch) requires the registry
 * migration (Phase 6). This hook provides client-side display caps only.
 *
 * @returns {{ getCaps: (key: string) => object|null }}
 */
export function useModelCaps() {
  const [byFull, setByFull] = useState({});
  const [byId, setById] = useState({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/models");
        if (!res.ok) return;
        const data = await res.json();
        const full = {};
        const id = {};
        for (const m of data.models || []) {
          if (!m.caps) continue;
          if (m.fullModel) full[m.fullModel] = m.caps;
          if (m.model) id[m.model] = m.caps;
        }
        if (alive) {
          setByFull(full);
          setById(id);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Resolve caps from a "provider/model" string or a bare model id.
  const getCaps = (key) => {
    if (!key) return null;
    if (byFull[key]) return byFull[key];
    const bare = key.includes("/") ? key.slice(key.indexOf("/") + 1) : key;
    return byId[bare] || null;
  };

  return { getCaps };
}
