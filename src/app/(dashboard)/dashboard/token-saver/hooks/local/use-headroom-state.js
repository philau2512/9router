import { useState, useEffect, useCallback, useRef } from "react";

export function useHeadroomState(patchSetting) {
  const [headroomEnabled, setHeadroomEnabled] = useState(false);
  const [headroomUrl, setHeadroomUrl] = useState("http://localhost:8787");
  const [headroomStatus, setHeadroomStatus] = useState({
    installed: false,
    running: false,
    python: null,
    loading: true,
  });
  const [showHeadroomInstallModal, setShowHeadroomInstallModal] =
    useState(false);
  const [headroomActionLoading, setHeadroomActionLoading] = useState(false);
  const [headroomActionError, setHeadroomActionError] = useState("");
  const [headroomExtras, setHeadroomExtras] = useState({
    version: null,
    extras: { code: false, ml: false },
    available: ["code", "ml"],
    loading: false,
  });
  const [pendingExtras, setPendingExtras] = useState([]);
  const [extrasActionLoading, setExtrasActionLoading] = useState(false);
  const [extrasActionError, setExtrasActionError] = useState("");
  const [removingExtra, setRemovingExtra] = useState(null);
  const [installLog, setInstallLog] = useState("");
  const [extrasConfirm, setExtrasConfirm] = useState(null);
  const [codeAware, setCodeAware] = useState(false);
  const [kompress, setKompress] = useState(true);
  const [restartingProxy, setRestartingProxy] = useState(false);
  const logPollRef = useRef(null);

  const handleHeadroomEnabled = useCallback(
    (value) => {
      const nextUrl = headroomUrl.trim() || "http://localhost:8787";
      setHeadroomUrl(nextUrl);
      setHeadroomEnabled(value);
      patchSetting({ headroomEnabled: value, headroomUrl: nextUrl });
    },
    [headroomUrl, patchSetting],
  );

  const refreshHeadroomStatus = useCallback(async () => {
    setHeadroomStatus((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch("/api/headroom/status", {
        headers: { "Cache-Control": "no-store" },
      });
      const data = await res.json();
      setHeadroomStatus({ ...data, loading: false });
      if (!data?.installed) {
        setHeadroomExtras({
          version: null,
          extras: { code: false, ml: false },
          available: ["code", "ml"],
          loading: false,
        });
        setPendingExtras([]);
        return;
      }
      try {
        const er = await fetch("/api/headroom/extras", {
          headers: { "Cache-Control": "no-store" },
        });
        if (!er.ok) throw new Error("extras status failed");
        const ed = await er.json();
        setHeadroomExtras((s) => ({
          ...s,
          version: ed.version ?? null,
          extras: ed.extras || { code: false, ml: false },
          available: ed.available || ["code", "ml"],
          loading: false,
        }));
        setPendingExtras([]);
      } catch {
        setHeadroomExtras({
          version: null,
          extras: { code: false, ml: false },
          available: ["code", "ml"],
          loading: false,
        });
        setPendingExtras([]);
      }
    } catch {
      setHeadroomStatus({
        installed: false,
        running: false,
        python: null,
        loading: false,
      });
      setHeadroomExtras({
        version: null,
        extras: { code: false, ml: false },
        available: ["code", "ml"],
        loading: false,
      });
      setPendingExtras([]);
    }
  }, []);

  const handleHeadroomUrlBlur = useCallback(async () => {
    const next = headroomUrl.trim() || "http://localhost:8787";
    setHeadroomUrl(next);
    await patchSetting({ headroomUrl: next });
    refreshHeadroomStatus();
  }, [headroomUrl, patchSetting, refreshHeadroomStatus]);

  const handleHeadroomStart = useCallback(async () => {
    setHeadroomActionError("");
    setHeadroomActionLoading(true);
    try {
      const res = await fetch("/api/headroom/start", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to start proxy");
      await refreshHeadroomStatus();
    } catch (e) {
      setHeadroomActionError(e.message);
    } finally {
      setHeadroomActionLoading(false);
    }
  }, [refreshHeadroomStatus]);

  const handleHeadroomStop = useCallback(async () => {
    setHeadroomActionLoading(true);
    try {
      await fetch("/api/headroom/stop", { method: "POST" });
      await refreshHeadroomStatus();
    } finally {
      setHeadroomActionLoading(false);
    }
  }, [refreshHeadroomStatus]);

  const togglePendingExtra = useCallback((extra) => {
    setPendingExtras((cur) =>
      cur.includes(extra) ? cur.filter((e) => e !== extra) : [...cur, extra],
    );
  }, []);

  const startLogPolling = useCallback(() => {
    setInstallLog("");
    if (logPollRef.current) clearInterval(logPollRef.current);
    const tick = async () => {
      try {
        const r = await fetch("/api/headroom/extras?log=1", {
          headers: { "Cache-Control": "no-store" },
        });
        const d = await r.json().catch(() => ({}));
        if (typeof d.log === "string") setInstallLog(d.log);
      } catch {
        /* ignore transient poll errors */
      }
    };
    tick();
    logPollRef.current = setInterval(tick, 1500);
  }, []);

  const stopLogPolling = useCallback(() => {
    if (logPollRef.current) {
      clearInterval(logPollRef.current);
      logPollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopLogPolling(), [stopLogPolling]);

  const installExtrasConfirmed = useCallback(async () => {
    if (pendingExtras.length === 0) return;
    setExtrasActionLoading(true);
    setExtrasActionError("");
    startLogPolling();
    try {
      const res = await fetch("/api/headroom/extras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extras: pendingExtras }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Install failed");
      setHeadroomExtras((s) => ({
        ...s,
        version: data.version ?? s.version,
        extras: data.extras || s.extras,
      }));
      setPendingExtras([]);
    } catch (e) {
      setExtrasActionError(e.message);
    } finally {
      stopLogPolling();
      setExtrasActionLoading(false);
    }
  }, [pendingExtras, startLogPolling, stopLogPolling]);

  const removeExtraConfirmed = useCallback(
    async (extra) => {
      setRemovingExtra(extra);
      setExtrasActionError("");
      startLogPolling();
      try {
        const res = await fetch("/api/headroom/extras", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extras: [extra] }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Remove failed");
        setHeadroomExtras((s) => ({
          ...s,
          version: data.version ?? s.version,
          extras: data.extras || s.extras,
        }));
      } catch (e) {
        setExtrasActionError(e.message);
      } finally {
        stopLogPolling();
        setRemovingExtra(null);
      }
    },
    [startLogPolling, stopLogPolling],
  );

  const handleInstallExtras = useCallback(() => {
    if (pendingExtras.length === 0) return;
    if (pendingExtras.includes("ml")) {
      setExtrasConfirm({
        title: "Install [ml]",
        message: "[ml] downloads ~1 GB (torch + huggingface-hub). Continue?",
        confirmText: "Install",
        variant: "primary",
        onConfirm: installExtrasConfirmed,
      });
      return;
    }
    installExtrasConfirmed();
  }, [pendingExtras, installExtrasConfirmed]);

  const handleRemoveExtra = useCallback(
    (extra) => {
      setExtrasConfirm({
        title: `Remove [${extra}]`,
        message: `Remove [${extra}] and its packages?`,
        confirmText: "Remove",
        variant: "danger",
        onConfirm: () => removeExtraConfirmed(extra),
      });
    },
    [removeExtraConfirmed],
  );

  const toggleExtraActive = useCallback(
    async (extra, value) => {
      setExtrasActionError("");
      if (extra === "code") setCodeAware(value);
      if (extra === "ml") setKompress(value);
      const key = extra === "code" ? "headroomCodeAware" : "headroomKompress";
      await patchSetting({ [key]: value });
      if (!headroomStatus.running) return;
      setRestartingProxy(true);
      try {
        const res = await fetch("/api/headroom/restart", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Restart failed");
        await refreshHeadroomStatus();
      } catch (e) {
        setExtrasActionError(e.message);
      } finally {
        setRestartingProxy(false);
      }
    },
    [headroomStatus.running, refreshHeadroomStatus, patchSetting],
  );

  return {
    headroomEnabled,
    setHeadroomEnabled,
    headroomUrl,
    setHeadroomUrl,
    headroomStatus,
    setHeadroomStatus,
    showHeadroomInstallModal,
    setShowHeadroomInstallModal,
    headroomActionLoading,
    headroomActionError,
    headroomExtras,
    setHeadroomExtras,
    pendingExtras,
    setPendingExtras,
    extrasActionLoading,
    extrasActionError,
    removingExtra,
    installLog,
    extrasConfirm,
    setExtrasConfirm,
    codeAware,
    setCodeAware,
    kompress,
    setKompress,
    restartingProxy,
    handleHeadroomEnabled,
    refreshHeadroomStatus,
    handleHeadroomUrlBlur,
    handleHeadroomStart,
    handleHeadroomStop,
    togglePendingExtra,
    handleInstallExtras,
    handleRemoveExtra,
    toggleExtraActive,
  };
}