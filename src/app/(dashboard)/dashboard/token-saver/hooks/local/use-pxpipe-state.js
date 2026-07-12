import { useState, useCallback } from "react";

export function usePxpipeState(patchSetting) {
  const [pxpipeEnabled, setPxpipeEnabled] = useState(false);
  const [pxpipeMinChars, setPxpipeMinChars] = useState(25000);
  const [pxpipeStatus, setPxpipeStatus] = useState({
    installed: false,
    installing: false,
    running: false,
    version: null,
    loading: true,
  });
  const [pxpipeHealth, setPxpipeHealth] = useState(null);
  const [showPxpipeModal, setShowPxpipeModal] = useState(false);
  const [pxpipeActionLoading, setPxpipeActionLoading] = useState(false);
  const [pxpipeActionError, setPxpipeActionError] = useState("");

  const refreshPxpipeStatus = useCallback(async () => {
    setPxpipeStatus((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch("/api/pxpipe/status", {
        headers: { "Cache-Control": "no-store" },
      });
      const data = await res.json();
      setPxpipeStatus({ ...data, loading: false });
      if (typeof data.minChars === "number") setPxpipeMinChars(data.minChars);
    } catch {
      setPxpipeStatus({
        installed: false,
        installing: false,
        running: false,
        version: null,
        loading: false,
      });
    }
  }, []);

  const runPxpipeHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/pxpipe/health", { method: "POST" });
      setPxpipeHealth(await res.json());
    } catch (e) {
      setPxpipeHealth({ healthy: false, checks: [], error: e.message });
    }
  }, []);

  const pxpipeAction = useCallback(
    async (endpoint) => {
      setPxpipeActionError("");
      setPxpipeActionLoading(true);
      try {
        const res = await fetch(`/api/pxpipe/${endpoint}`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `PXPIPE ${endpoint} failed`);
        await refreshPxpipeStatus();
        await runPxpipeHealth();
      } catch (e) {
        setPxpipeActionError(e.message);
      } finally {
        setPxpipeActionLoading(false);
      }
    },
    [refreshPxpipeStatus, runPxpipeHealth],
  );

  const handlePxpipeEnabled = useCallback(
    (value) => {
      setPxpipeEnabled(value);
      patchSetting({ pxpipeEnabled: value });
    },
    [patchSetting],
  );

  const handlePxpipeMinCharsBlur = useCallback(() => {
    const next = Math.max(0, Number(pxpipeMinChars) || 25000);
    setPxpipeMinChars(next);
    patchSetting({ pxpipeMinChars: next });
  }, [pxpipeMinChars, patchSetting]);

  return {
    pxpipeEnabled,
    setPxpipeEnabled,
    pxpipeMinChars,
    setPxpipeMinChars,
    pxpipeStatus,
    setPxpipeStatus,
    pxpipeHealth,
    setPxpipeHealth,
    showPxpipeModal,
    setShowPxpipeModal,
    pxpipeActionLoading,
    pxpipeActionError,
    refreshPxpipeStatus,
    runPxpipeHealth,
    pxpipeAction,
    handlePxpipeEnabled,
    handlePxpipeMinCharsBlur,
  };
}