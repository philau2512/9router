import { Button } from "@/shared/components";
import BaseUrlSelect from "../BaseUrlSelect";
import ApiKeySelect from "../ApiKeySelect";
import { stripV1 } from "./helpers";

export function CoworkToolConfigForm({
  status,
  getEffectiveBaseUrl,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
  cloudEnabled,
  cloudUrl,
  setCustomBaseUrl,
  selectedApiKey,
  setSelectedApiKey,
  apiKeys,
  selectedModels,
  handleRemoveModel,
  setComboModalOpen,
  hasActiveProviders,
  plugins,
  customPlugins,
  removePlugin,
  setMarketplaceOpen,
  setAddMcpForm,
  setAddMcpOpen,
  setPlugins,
  setLocalPlugins,
  localPlugins,
  setCustomPlugins,
  message,
  handleApply,
  applying,
  handleReset,
  restoring,
  setShowManualConfigModal,
  setModelSelectOpen,
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
          <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
            Select Endpoint
          </span>
          <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">
            arrow_forward
          </span>
          <BaseUrlSelect
            value={getEffectiveBaseUrl()}
            onChange={(url) => setCustomBaseUrl(stripV1(url))}
            tunnelEnabled={tunnelEnabled}
            tunnelPublicUrl={tunnelPublicUrl}
            tailscaleEnabled={tailscaleEnabled}
            tailscaleUrl={tailscaleUrl}
            cloudEnabled={cloudEnabled}
            cloudUrl={cloudUrl}
          />
        </div>

        {status?.cowork?.baseUrl && (
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
            <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
              Current
            </span>
            <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">
              arrow_forward
            </span>
            <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
              {status.cowork.baseUrl}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
          <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
            API Key
          </span>
          <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">
            arrow_forward
          </span>
          <ApiKeySelect
            value={selectedApiKey}
            onChange={setSelectedApiKey}
            apiKeys={apiKeys}
            cloudEnabled={cloudEnabled}
          />
        </div>

        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
          <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right">
            Models
          </span>
          <span className="material-symbols-outlined text-text-muted text-[14px]">
            arrow_forward
          </span>
            <div className="flex-1 flex items-center gap-2">
              <div className="flex-1 flex flex-wrap gap-1.5 min-h-[28px] px-2 py-1.5 bg-surface rounded border border-border">
                {selectedModels.length === 0 ? (
                  <span className="text-xs text-text-muted">
                    No models selected
                  </span>
                ) : (
                  selectedModels.map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-black/5 dark:bg-white/5 text-text-muted border border-transparent hover:border-border"
                    >
                      {m}
                      <button
                        onClick={() => handleRemoveModel(m)}
                        className="ml-0.5 hover:text-red-500"
                      >
                        <span className="material-symbols-outlined text-[12px]">
                          close
                        </span>
                      </button>
                    </span>
                  ))
                )}
              </div>
              <button
                onClick={() => setModelSelectOpen(true)}
                className="shrink-0 px-2 py-1.5 rounded border text-xs bg-surface border-border text-text-muted hover:border-primary hover:text-primary cursor-pointer whitespace-nowrap"
              >
                + Model
              </button>
              <button
                onClick={() => setComboModalOpen(true)}
                disabled={!hasActiveProviders}
                className={`shrink-0 px-2 py-1.5 rounded border text-xs whitespace-nowrap transition-colors ${hasActiveProviders ? "bg-primary/10 border-primary/40 text-primary hover:bg-primary/20 cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}
              >
                + Combo
              </button>
            </div>
        </div>

        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
          <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-2">
            MCP
          </span>
          <span className="material-symbols-outlined text-text-muted text-[14px] mt-2">
            arrow_forward
          </span>
          <div className="flex-1 flex flex-col gap-1">
            {/* Preset plugins */}
            {plugins
              .filter((p) => p.name !== "exa")
              .map((p) => (
                <div
                  key={p.name}
                  className="flex items-center gap-2 px-2 py-1 bg-surface rounded border border-border"
                >
                  <span className="text-xs font-medium min-w-0 truncate flex-shrink-0">
                    {p.title || p.name}
                  </span>
                  {p.oauth && (
                    <span className="text-[8px] text-amber-600 shrink-0">
                      OAuth
                    </span>
                  )}
                  <div
                    className="flex-1 flex flex-wrap gap-1 overflow-hidden"
                    style={{ maxHeight: "1.5rem" }}
                  >
                    {Array.isArray(p.toolNames) &&
                      p.toolNames.slice(0, 6).map((t) => (
                        <span
                          key={t}
                          className="text-[9px] px-1 py-0.5 rounded bg-black/5 dark:bg-white/5 text-text-muted whitespace-nowrap"
                        >
                          {t}
                        </span>
                      ))}
                    {Array.isArray(p.toolNames) &&
                      p.toolNames.length > 6 && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-black/5 dark:bg-white/5 text-text-muted whitespace-nowrap">
                          +{p.toolNames.length - 6}
                        </span>
                      )}
                  </div>
                  <button
                    onClick={() => removePlugin(p.name)}
                    className="shrink-0 hover:text-red-500 ml-auto"
                  >
                    <span className="material-symbols-outlined text-[12px]">
                      close
                    </span>
                  </button>
                </div>
              ))}
            {/* Custom plugins */}
            {customPlugins.map((p) => (
              <div
                key={p.name}
                className="flex items-center gap-2 px-2 py-1 bg-surface rounded border border-border"
              >
                <span className="text-xs font-medium min-w-0 truncate flex-shrink-0">
                  {p.name}
                </span>
                <span className="text-[8px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-500 shrink-0">
                  custom
                </span>
                <span className="flex-1 text-[9px] text-text-muted truncate">
                  {p.url || p.command}
                </span>
                <button
                  onClick={() =>
                    setCustomPlugins(
                      customPlugins.filter((x) => x.name !== p.name),
                    )
                  }
                  className="shrink-0 hover:text-red-500 ml-auto"
                >
                  <span className="material-symbols-outlined text-[12px]">
                    close
                  </span>
                </button>
              </div>
            ))}
            {plugins.filter((p) => p.name !== "exa").length === 0 &&
              customPlugins.length === 0 && (
                <div className="px-2 py-1.5 bg-surface rounded border border-border text-xs text-text-muted">
                  No MCPs added
                </div>
              )}
            {/* Actions row */}
            <div className="flex items-center gap-2 mt-0.5">
              <button
                onClick={() => setMarketplaceOpen(true)}
                className="px-2 py-1 rounded border text-xs bg-primary/10 border-primary/40 text-primary hover:bg-primary/20 cursor-pointer whitespace-nowrap"
              >
                + Browse
              </button>
              <button
                onClick={() => {
                  setAddMcpForm({
                    type: "url",
                    name: "",
                    url: "",
                    command: "",
                    args: "",
                  });
                  setAddMcpOpen(true);
                }}
                className="px-2 py-1 rounded border text-xs bg-surface border-border text-text-muted hover:border-primary hover:text-primary cursor-pointer whitespace-nowrap"
              >
                + Custom
              </button>
              <a
                href="https://mcp.so"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-text-muted hover:text-primary underline ml-auto"
              >
                Find MCPs →
              </a>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
          <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-1">
            Tools
          </span>
          <span className="material-symbols-outlined text-text-muted text-[14px] mt-1.5">
            arrow_forward
          </span>
          <div className="flex-1 flex flex-col gap-1.5">
            {(() => {
              const exaEnabled = plugins.some((p) => p.name === "exa");
              const exaDef = (status?.defaultPlugins || []).find(
                (d) => d.name === "exa",
              );
              return (
                <label className="flex items-start gap-2 cursor-pointer px-2 py-1.5 bg-surface rounded border border-border">
                  <input
                    type="checkbox"
                    checked={exaEnabled}
                    onChange={(e) => {
                      if (e.target.checked && exaDef)
                        setPlugins([
                          ...plugins.filter((p) => p.name !== "exa"),
                          exaDef,
                        ]);
                      else
                        setPlugins(
                          plugins.filter((p) => p.name !== "exa"),
                        );
                    }}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium">
                      Web Search & Fetch (Exa)
                    </div>
                    <p className="text-[10px] text-text-muted leading-snug">
                      Replaces built-in WebSearch/WebFetch. Auto-strips
                      duplicates from tool list.
                    </p>
                  </div>
                </label>
              );
            })()}
            {(() => {
              const browserDef = (status?.localStdioPlugins || []).find(
                (p) => p.name === "browsermcp",
              );
              if (!browserDef) return null;
              const browserEnabled =
                localPlugins.includes("browsermcp");
              return (
                <label className="flex items-start gap-2 cursor-pointer px-2 py-1.5 bg-surface rounded border border-border">
                  <input
                    type="checkbox"
                    checked={browserEnabled}
                    onChange={(e) =>
                      setLocalPlugins(
                        e.target.checked
                          ? [...localPlugins, "browsermcp"]
                          : localPlugins.filter(
                              (n) => n !== "browsermcp",
                            ),
                      )
                    }
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium">
                      Browser Control (Browser MCP)
                    </div>
                    <p className="text-[10px] text-text-muted leading-snug">
                      Controls your running Chrome. Auto-strips
                      Cowork&apos;s built-in browser tools.{" "}
                      <a
                        href={browserDef.extensionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        Install Chrome extension
                      </a>
                    </p>
                  </div>
                </label>
              );
            })()}
          </div>
        </div>

        {Array.isArray(status?.localStdioPlugins) &&
          status.localStdioPlugins.filter(
            (p) => p.name !== "browsermcp",
          ).length > 0 && (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
              <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-1">
                Local Plugins
              </span>
              <span className="material-symbols-outlined text-text-muted text-[14px] mt-1.5">
                arrow_forward
              </span>
              <div className="flex-1 flex flex-col gap-2">
                <div className="flex flex-col gap-1.5 px-2 py-1.5 bg-surface rounded border border-border">
                  {status.localStdioPlugins
                    .filter((p) => p.name !== "browsermcp")
                    .map((p) => {
                      const enabled = localPlugins.includes(p.name);
                      return (
                        <label
                          key={p.name}
                          className="flex items-start gap-2 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(e) =>
                              setLocalPlugins(
                                e.target.checked
                                  ? [...localPlugins, p.name]
                                  : localPlugins.filter(
                                      (n) => n !== p.name,
                                    ),
                              )
                            }
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-medium">
                                {p.title}
                              </span>
                              <span className="text-[8px] text-amber-600">
                                stdio
                              </span>
                            </div>
                            <p className="text-[10px] text-text-muted leading-snug">
                              {p.description}
                            </p>
                            {p.extensionUrl && (
                              <a
                                href={p.extensionUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-primary underline"
                              >
                                Install Chrome extension
                              </a>
                            )}
                          </div>
                        </label>
                      );
                    })}
                </div>
                <p className="text-[10px] text-text-muted leading-snug">
                  ⚠️ Local plugins run as subprocess via{" "}
                  <code className="px-1 py-0.5 rounded bg-black/5 dark:bg-white/5">
                    npx
                  </code>
                  . Requires Node.js installed.
                </p>
              </div>
            </div>
          )}
      </div>

      {message && (
        <div
          className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs mt-2 ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}
        >
          <span className="material-symbols-outlined text-[14px]">
            {message.type === "success" ? "check_circle" : "error"}
          </span>
          <span>{message.text}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-4">
        <Button
          variant="primary"
          size="sm"
          onClick={handleApply}
          disabled={selectedModels.length === 0}
          loading={applying}
          className="w-full sm:w-auto"
        >
          <span className="material-symbols-outlined text-[14px] mr-1">
            save
          </span>
          Apply
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          disabled={!status.has9Router}
          loading={restoring}
          className="w-full sm:w-auto"
        >
          <span className="material-symbols-outlined text-[14px] mr-1">
            restore
          </span>
          Reset
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowManualConfigModal(true)}
          className="w-full sm:w-auto"
        >
          <span className="material-symbols-outlined text-[14px] mr-1">
            content_copy
          </span>
          Manual Config
        </Button>
      </div>
    </>
  );
}