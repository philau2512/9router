"use client";

import ProviderIcon from "@/shared/components/ProviderIcon";
import {
  shouldResetPage,
  ACCOUNT_FILTER_OPTIONS,
  QUOTA_SORT_OPTIONS,
} from "./helpers";

export default function ProviderLimitsHeader({
  providerFilter,
  setProviderFilter,
  providerMenuOpen,
  setProviderMenuOpen,
  providerOptions,
  accountFilter,
  setAccountFilter,
  searchInput,
  setSearchInput,
  quotaSortMode,
  setQuotaSortMode,
  expiringFirst,
  setExpiringFirst,
  bulkToggling,
  handleDisableDepleted,
  handleEnableAvailable,
  autoRefresh,
  setAutoRefresh,
  countdown,
  refreshingAll,
  refreshAll,
  setPage,
}) {
  const selectedProviderLabel =
    providerFilter === "all" ? "All providers" : providerFilter;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 material-symbols-outlined text-[14px] text-text-muted">
            search
          </span>
          <input
            type="text"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search name, email…"
            aria-label="Search accounts by name or email"
            autoComplete="off"
            spellCheck={false}
            className="h-8 w-40 sm:w-52 rounded-lg border border-black/10 bg-black/[0.02] py-0 pl-7 pr-7 text-xs text-text-primary outline-none transition-colors placeholder:text-text-muted hover:bg-black/5 focus:border-primary/40 focus:bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/10 dark:focus:bg-white/[0.05]"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-text-muted transition-colors hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/10"
              aria-label="Clear account search"
              title="Clear search"
            >
              <span className="material-symbols-outlined text-[14px]">
                close
              </span>
            </button>
          ) : null}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setProviderMenuOpen((prev) => !prev)}
            className="flex h-8 items-center justify-between gap-1 rounded-lg border border-black/10 bg-black/[0.02] px-2 text-xs text-text-primary transition-colors hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/10"
            aria-haspopup="menu"
            aria-expanded={providerMenuOpen}
            title="Filter quota providers"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {providerFilter === "all" ? (
                <span className="material-symbols-outlined text-[14px] text-text-muted">
                  apps
                </span>
              ) : (
                <ProviderIcon
                  src={`/providers/${providerFilter}.png`}
                  alt={providerFilter}
                  size={18}
                  className="size-[18px] rounded object-contain"
                  fallbackText={providerFilter.slice(0, 2).toUpperCase()}
                />
              )}
              <span className="truncate capitalize hidden lg:inline">
                {selectedProviderLabel}
              </span>
            </span>
            <span className="material-symbols-outlined text-[14px] text-text-muted">
              expand_more
            </span>
          </button>

          {providerMenuOpen && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-30 bg-transparent"
                aria-label="Close provider filter"
                onClick={() => setProviderMenuOpen(false)}
              />
              <div className="absolute left-0 z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-black/10 bg-surface/95 p-1.5 shadow-xl shadow-black/10 backdrop-blur dark:border-white/10 dark:bg-surface/95 sm:w-72">
                <button
                  type="button"
                  onClick={() => {
                    if (shouldResetPage(providerFilter, "all")) {
                      setPage(1);
                    }
                    setProviderFilter("all");
                    setProviderMenuOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${providerFilter === "all" ? "bg-primary/10 text-primary" : "text-text-primary hover:bg-black/5 dark:hover:bg-white/10"}`}
                >
                  <span className="material-symbols-outlined text-[22px]">
                    apps
                  </span>
                  <span className="font-medium">All providers</span>
                  {providerFilter === "all" && (
                    <span className="material-symbols-outlined ml-auto text-[20px]">
                      check
                    </span>
                  )}
                </button>
                <div className="my-1 h-px bg-black/10 dark:bg-white/10" />
                <div className="max-h-72 overflow-y-auto pr-1">
                  {providerOptions.map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      onClick={() => {
                        if (shouldResetPage(providerFilter, provider)) {
                          setPage(1);
                        }
                        setProviderFilter(provider);
                        setProviderMenuOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${providerFilter === provider ? "bg-primary/10 text-primary" : "text-text-primary hover:bg-black/5 dark:hover:bg-white/10"}`}
                    >
                      <ProviderIcon
                        src={`/providers/${provider}.png`}
                        alt={provider}
                        size={24}
                        className="size-6 rounded-md object-contain"
                        fallbackText={provider.slice(0, 2).toUpperCase()}
                      />
                      <span className="font-medium capitalize">
                        {provider}
                      </span>
                      {providerFilter === provider && (
                        <span className="material-symbols-outlined ml-auto text-[20px]">
                          check
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <select
          value={accountFilter}
          onChange={(event) => {
            const nextValue = event.target.value;
            if (shouldResetPage(accountFilter, nextValue)) {
              setPage(1);
            }
            setAccountFilter(nextValue);
          }}
          className="h-8 rounded-lg border border-black/10 bg-black/[0.02] px-2 text-xs text-text-primary outline-none transition-colors hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/10"
          aria-label="Filter accounts by status"
        >
          {ACCOUNT_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {providerFilter === "codex" && (
          <select
            value={quotaSortMode}
            onChange={(event) => setQuotaSortMode(event.target.value)}
            className="h-8 rounded-lg border border-black/10 bg-black/[0.02] px-2 text-xs text-text-primary outline-none transition-colors hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/10"
            aria-label="Sort Codex quotas by remaining"
          >
            {QUOTA_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          onClick={() => setExpiringFirst((prev) => !prev)}
          aria-pressed={expiringFirst}
          className={`flex h-8 shrink-0 items-center gap-1 rounded-lg border px-2 text-xs transition-colors ${expiringFirst ? "border-amber-500/40 bg-amber-500/10 text-amber-500" : "border-black/10 text-text-primary hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"}`}
          title="Sort accounts by earliest quota reset time"
        >
          <span className="material-symbols-outlined text-[14px]">
            hourglass_top
          </span>
          <span className="hidden sm:inline">Expiring first</span>
        </button>

        {/* Bulk: disable depleted */}
        <button
          type="button"
          onClick={handleDisableDepleted}
          disabled={bulkToggling}
          className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-red-500/30 px-2 text-xs text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          title="Disable connections with depleted quota on the current page"
        >
          <span className="material-symbols-outlined text-[14px]">block</span>
          <span className="hidden sm:inline">Turn off Empty</span>
        </button>

        {/* Bulk: enable available */}
        <button
          type="button"
          onClick={handleEnableAvailable}
          disabled={bulkToggling}
          className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-emerald-500/30 px-2 text-xs text-emerald-500 transition-colors hover:bg-emerald-500/10 disabled:opacity-50"
          title="Enable connections that still have quota on the current page"
        >
          <span className="material-symbols-outlined text-[14px]">
            check_circle
          </span>
          <span className="hidden sm:inline">Turn on Available</span>
        </button>

        {/* Auto-refresh toggle */}
        <button
          onClick={() => setAutoRefresh((prev) => !prev)}
          className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-black/10 px-2 text-xs transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          title={autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh"}
        >
          <span
            className={`material-symbols-outlined text-[14px] ${
              autoRefresh ? "text-primary" : "text-text-muted"
            }`}
          >
            {autoRefresh ? "toggle_on" : "toggle_off"}
          </span>
          <span className="hidden text-text-primary sm:inline">
            Auto-refresh
          </span>
          {autoRefresh && (
            <span className="text-[10px] text-text-muted tabular-nums">
              ({countdown}s)
            </span>
          )}
        </button>

        {/* Refresh all button */}
        <button
          type="button"
          onClick={refreshAll}
          disabled={refreshingAll}
          className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-black/10 px-2 text-xs text-text-primary transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5 disabled:opacity-50"
          title="Refresh all"
        >
          <span
            className={`material-symbols-outlined text-[14px] ${refreshingAll ? "animate-spin" : ""}`}
          >
            refresh
          </span>
        </button>
      </div>
    </div>
  );
}