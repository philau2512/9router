"use client";

import { useCallback, useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import ModelSelectModal from "@/shared/components/ModelSelectModal";

export default function CursorLocalPageClient() {
  const [status, setStatus] = useState(null);
  const [models, setModels] = useState([]);
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [newDisplay, setNewDisplay] = useState("");
  const [newRouterModel, setNewRouterModel] = useState("");
  const [filter, setFilter] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  /** Local edit buffer — only persisted on Save */
  const [draft, setDraft] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [s, m, l] = await Promise.all([
        fetch("/api/cursor-local/status").then((r) => r.json()),
        fetch("/api/cursor-local/models").then((r) => r.json()),
        fetch("/api/cursor-local/logs?tail=80").then((r) => r.json()),
      ]);
      setStatus(s);
      // Don't clobber in-progress form edits
      setModels((prev) => {
        if (draft) return prev;
        return m.models || [];
      });
      setLogs(l.lines || []);
      setError("");
    } catch (e) {
      setError(e.message || "refresh failed");
    }
  }, [draft]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  // Load providers + aliases for ModelSelectModal (same as Combo)
  useEffect(() => {
    Promise.all([
      fetch("/api/providers").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/models/alias").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([prov, alias]) => {
        if (prov?.connections) setActiveProviders(prov.connections);
        if (alias?.aliases) setModelAliases(alias.aliases);
      })
      .catch(() => {});
  }, []);

  async function start() {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const res = await fetch("/api/cursor-local/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "start failed");
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/cursor-local/stop", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "stop failed");
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveModels(next) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/cursor-local/models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save models failed");
      setModels(data.models || next);
      setInfo(
        next.length
          ? `Saved ${next.length} model(s) for Cursor picker`
          : "Model map cleared",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  /** ModelSelectModal passes { name, value, ... } like Combo */
  function handleSelectModel(model) {
    const routerModel = String(model?.value || model?.name || model || "").trim();
    if (!routerModel) return;
    if (models.some((m) => m.routerModel === routerModel)) return;
    const displayName = String(model?.name || routerModel).trim() || routerModel;
    saveModels([
      ...models,
      {
        displayName,
        routerModel,
        contextWindowTokens: 200000,
        maxCompletionTokens: 0,
        reasoningEffort: "medium",
        openAIEndpoint: "/v1/chat/completions",
        source: "picker",
      },
    ]);
  }

  function openEditor(m) {
    const key = m.id || m.routerModel;
    if (expandedId === key) {
      setExpandedId(null);
      setDraft(null);
      return;
    }
    setExpandedId(key);
    setDraft({
      routerModel: m.routerModel,
      contextWindowTokens: m.contextWindowTokens || 0,
      maxCompletionTokens: m.maxCompletionTokens || 0,
      reasoningEffort: m.reasoningEffort || "medium",
      openAIEndpoint: m.openAIEndpoint || "/v1/chat/completions",
    });
  }

  function patchDraft(patch) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  async function saveDraft() {
    if (!draft?.routerModel) return;
    const next = models.map((m) =>
      m.routerModel === draft.routerModel
        ? {
            ...m,
            contextWindowTokens: Number(draft.contextWindowTokens) || 0,
            maxCompletionTokens: Number(draft.maxCompletionTokens) || 0,
            reasoningEffort: draft.reasoningEffort || "medium",
            openAIEndpoint:
              draft.openAIEndpoint || "/v1/chat/completions",
          }
        : m,
    );
    await saveModels(next);
    setExpandedId(null);
    setDraft(null);
  }

  function cancelDraft() {
    setExpandedId(null);
    setDraft(null);
  }

  function handleDeselectModel(model) {
    const routerModel = String(model?.value || model?.name || model || "").trim();
    if (!routerModel) return;
    saveModels(models.filter((m) => m.routerModel !== routerModel));
  }

  function removeModel(routerModelOrId) {
    saveModels(
      models.filter(
        (m) =>
          m.routerModel !== routerModelOrId &&
          m.id !== routerModelOrId &&
          m.displayName !== routerModelOrId,
      ),
    );
  }

  function addModelManual() {
    if (!newDisplay.trim() || !newRouterModel.trim()) return;
    const routerModel = newRouterModel.trim();
    if (models.some((m) => m.routerModel === routerModel)) {
      setError("Model already in map");
      return;
    }
    const next = [
      ...models,
      {
        displayName: newDisplay.trim(),
        routerModel,
        contextWindowTokens: 200000,
        maxCompletionTokens: 0,
        reasoningEffort: "medium",
        openAIEndpoint: "/v1/chat/completions",
        source: "manual",
      },
    ];
    setNewDisplay("");
    setNewRouterModel("");
    saveModels(next);
  }

  const running = !!status?.running;
  const selectedValues = models.map((m) => m.routerModel).filter(Boolean);
  const q = filter.trim().toLowerCase();
  const visible = q
    ? models.filter(
        (m) =>
          m.displayName?.toLowerCase().includes(q) ||
          m.routerModel?.toLowerCase().includes(q),
      )
    : models;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-text-main">Cursor Local</h1>
        <p className="text-sm text-text-muted mt-1">
          Unofficial local Cursor backend. Pick a curated model set for Cursor
          (same picker as Combos) — only selected models appear in Cursor.
          Usually no restart needed; Reload Window if proxy/auth lag.
        </p>
      </div>

      <Card className="p-4 border border-amber-500/40 bg-amber-500/5">
        <p className="text-sm text-amber-800 dark:text-amber-200">
          ⚠️ Fake Ultra session + MITM may violate Cursor ToS. Use only on your
          own machine. Stop restores auth/settings. Disable Cursor DNS on the
          MITM page while this is running.
        </p>
      </Card>

      {error ? (
        <Card className="p-3 border border-red-500/40 text-sm text-red-600">
          {error}
        </Card>
      ) : null}
      {info ? (
        <Card className="p-3 border border-green-500/30 text-sm text-green-700 dark:text-green-300">
          {info}
        </Card>
      ) : null}

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <div className="text-sm font-medium">
              Status:{" "}
              <span className={running ? "text-green-600" : "text-text-muted"}>
                {running ? "Running" : "Stopped"}
              </span>
              {status?.phase ? (
                <span className="ml-2 text-xs text-text-muted">
                  phase {status.phase}
                </span>
              ) : null}
            </div>
            <div className="text-xs text-text-muted mt-1 space-y-0.5">
              <div>Backend: {status?.backendListenAddr || "—"}</div>
              <div>Proxy: {status?.proxyListenAddr || "—"}</div>
              <div>
                Settings applied: {String(status?.settingsApplied ?? "—")} ·
                Auth injected: {String(status?.authInjected ?? "—")} · Cert:{" "}
                {String(status?.certTrusted ?? "—")}
              </div>
              <div className="truncate">Data: {status?.dataDir || "—"}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={busy || running}
              onClick={start}
              className="min-w-[96px]"
            >
              Start
            </Button>
            <Button
              disabled={busy || !running}
              onClick={stop}
              variant="secondary"
              className="min-w-[96px]"
            >
              Stop
            </Button>
            <Button disabled={busy} onClick={refresh} variant="ghost">
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Models for Cursor</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Click <strong>Add models…</strong> — same multi-select as Combo.
              Only these appear in Cursor&apos;s model list.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !models.length}
              onClick={() => {
                if (
                  !models.length ||
                  !window.confirm(
                    `Clear all ${models.length} selected model(s)?`,
                  )
                )
                  return;
                saveModels([]);
              }}
              variant="ghost"
              size="sm"
            >
              Clear all
            </Button>
            <Button
              disabled={busy}
              onClick={() => setShowModelSelect(true)}
              size="sm"
            >
              Add models…
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <span>
            {models.length} selected
            {q ? ` · showing ${visible.length}` : ""}
          </span>
          {models.length > 5 ? (
            <input
              className="border border-border rounded px-2 py-1 text-xs bg-surface min-w-[160px]"
              placeholder="Filter selected…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          ) : null}
        </div>

        <ul className="space-y-2 max-h-[28rem] overflow-auto">
          {visible.map((m) => {
            const key = m.id || m.routerModel;
            const open = expandedId === key;
            const d =
              open && draft?.routerModel === m.routerModel ? draft : null;
            return (
              <li
                key={key}
                className="border border-border rounded text-sm overflow-hidden"
              >
                <div className="flex items-center justify-between gap-2 px-2 py-1.5 bg-surface">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left truncate hover:opacity-80"
                    onClick={() => openEditor(m)}
                    title="Edit model parameters"
                  >
                    <span className="material-symbols-outlined text-[14px] align-middle mr-1 text-text-muted">
                      {open ? "expand_more" : "chevron_right"}
                    </span>
                    <strong>{m.displayName}</strong>
                    <span className="text-text-muted text-xs">
                      {" "}
                      → {m.routerModel}
                    </span>
                    {(m.reasoningEffort ||
                      m.contextWindowTokens ||
                      m.maxCompletionTokens ||
                      (m.openAIEndpoint &&
                        m.openAIEndpoint !== "/v1/chat/completions")) && (
                      <span className="ml-2 text-[10px] text-text-muted">
                        {[
                          m.contextWindowTokens
                            ? `ctx ${m.contextWindowTokens}`
                            : null,
                          m.reasoningEffort || null,
                          m.maxCompletionTokens
                            ? `max ${m.maxCompletionTokens}`
                            : null,
                          m.openAIEndpoint &&
                          m.openAIEndpoint !== "/v1/chat/completions"
                            ? m.openAIEndpoint
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-red-500 hover:underline shrink-0"
                    onClick={() => {
                      if (open) cancelDraft();
                      removeModel(m.routerModel || m.id);
                    }}
                  >
                    Remove
                  </button>
                </div>
                {open && d ? (
                  <div className="p-3 border-t border-border bg-bg-secondary/40 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className="text-xs space-y-1">
                        <span className="text-text-muted">Context Window</span>
                        <input
                          type="number"
                          min={0}
                          className="w-full border border-border rounded px-2 py-1 text-sm bg-surface"
                          placeholder="e.g. 200000"
                          value={d.contextWindowTokens || ""}
                          onChange={(e) =>
                            patchDraft({
                              contextWindowTokens: e.target.value
                                ? Number(e.target.value)
                                : 0,
                            })
                          }
                        />
                      </label>
                      <label className="text-xs space-y-1">
                        <span className="text-text-muted">
                          Reasoning Effort
                        </span>
                        <select
                          className="w-full border border-border rounded px-2 py-1 text-sm bg-surface"
                          value={d.reasoningEffort || "medium"}
                          onChange={(e) =>
                            patchDraft({ reasoningEffort: e.target.value })
                          }
                        >
                          <option value="">Default (none)</option>
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="xhigh">XHigh</option>
                          <option value="max">Max</option>
                        </select>
                      </label>
                      <label className="text-xs space-y-1">
                        <span className="text-text-muted">
                          Max Output Tokens
                        </span>
                        <input
                          type="number"
                          min={0}
                          className="w-full border border-border rounded px-2 py-1 text-sm bg-surface"
                          placeholder="e.g. 65536 (blank = default)"
                          value={d.maxCompletionTokens || ""}
                          onChange={(e) =>
                            patchDraft({
                              maxCompletionTokens: e.target.value
                                ? Number(e.target.value)
                                : 0,
                            })
                          }
                        />
                      </label>
                      <label className="text-xs space-y-1">
                        <span className="text-text-muted">API Endpoint</span>
                        <select
                          className="w-full border border-border rounded px-2 py-1 text-sm bg-surface"
                          value={d.openAIEndpoint || "/v1/chat/completions"}
                          onChange={(e) =>
                            patchDraft({ openAIEndpoint: e.target.value })
                          }
                        >
                          <option value="/v1/chat/completions">
                            /v1/chat/completions
                          </option>
                          <option value="/v1/responses">/v1/responses</option>
                        </select>
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={cancelDraft}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={saveDraft}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
          {!models.length ? (
            <li className="text-xs text-text-muted py-3 text-center border border-dashed border-border rounded">
              No models selected. Use <strong>Add models…</strong> (like Combo)
              to pick a curated set.
            </li>
          ) : null}
        </ul>

        <div className="flex flex-wrap gap-2 pt-1 border-t border-border">
          <input
            className="border border-border rounded px-2 py-1 text-sm bg-surface flex-1 min-w-[140px]"
            placeholder="Display name (manual)"
            value={newDisplay}
            onChange={(e) => setNewDisplay(e.target.value)}
          />
          <input
            className="border border-border rounded px-2 py-1 text-sm bg-surface flex-1 min-w-[140px]"
            placeholder="Router model / alias"
            value={newRouterModel}
            onChange={(e) => setNewRouterModel(e.target.value)}
          />
          <Button disabled={busy} onClick={addModelManual} variant="secondary">
            Add manual
          </Button>
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Logs (tail)</h2>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const res = await fetch("/api/cursor-local/logs", {
                  method: "DELETE",
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "clear logs failed");
                setLogs([]);
                setInfo("Logs cleared");
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Clear log
          </Button>
        </div>
        <pre className="text-[11px] leading-relaxed max-h-64 overflow-auto bg-bg-secondary rounded p-2 text-text-muted whitespace-pre-wrap">
          {logs.length ? logs.join("\n") : "No logs yet."}
        </pre>
      </Card>

      <ModelSelectModal
        isOpen={showModelSelect}
        onClose={() => setShowModelSelect(false)}
        onSelect={handleSelectModel}
        onDeselect={handleDeselectModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select models for Cursor"
        kindFilter="llm"
        addedModelValues={selectedValues}
        closeOnSelect={false}
      />
    </div>
  );
}
