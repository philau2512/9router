"use client";

import Card from "@/shared/components/Card";
import { ConfirmModal, EditConnectionModal } from "@/shared/components";
import { useProviderLimits } from "./hooks/local/use-provider-limits";
import ProviderLimitsHeader from "./components/local/provider-limits-header";
import ProviderConnectionCard from "./components/local/provider-connection-card";
import CodexResetCreditsModal from "./components/local/codex-reset-credits-modal";
import {
  getConnectionsPaginationSummary,
  getPageSizeLabel,
  ACCOUNT_PAGE_SIZE_OPTIONS,
  ACCOUNT_PAGE_SIZE_MAX,
} from "./components/local/helpers";

export default function ProviderLimits() {
  const {
    copied,
    copy,
    quotaData,
    loading,
    errors,
    autoRefresh,
    setAutoRefresh,
    refreshingAll,
    countdown,
    connectionsLoading,
    deletingId,
    togglingId,
    resettingLimitId,
    autoPingSavingId,
    resetConfirmState,
    setResetConfirmState,
    autoPingMaps,
    toggleAutoPing,
    resetCreditsState,
    setResetCreditsState,
    showEditModal,
    setShowEditModal,
    selectedConnection,
    setSelectedConnection,
    proxyPools,
    providerFilter,
    setProviderFilter,
    providerOptions,
    accountFilter,
    setAccountFilter,
    searchInput,
    setSearchInput,
    searchQuery,
    quotaSortMode,
    setQuotaSortMode,
    expiringFirst,
    setExpiringFirst,
    providerMenuOpen,
    setProviderMenuOpen,
    bulkToggling,
    setPage,
    pageSize,
    setPageSize,
    customPageSizeInput,
    setCustomPageSizeInput,
    pagination,
    totals,
    refreshAll,
    refreshProvider,
    handleDeleteConnection,
    handleResetCodexLimit,
    handleViewCodexResetCredits,
    handleToggleConnectionActive,
    handleUpdateConnection,
    handleDisableDepleted,
    handleEnableAvailable,
    sortedConnections,
  } = useProviderLimits();

  const hasEligibleConnections = totals.eligibleConnections > 0;
  const hasVisibleConnections = sortedConnections.length > 0;
  const connectionsPageSummary = getConnectionsPaginationSummary(pagination);
  const isCustomPageSize = !ACCOUNT_PAGE_SIZE_OPTIONS.includes(pageSize);
  const pageSizeLabel = getPageSizeLabel(pageSize, isCustomPageSize);

  if (!connectionsLoading && !hasEligibleConnections) {
    return (
      <Card padding="lg">
        <div className="py-12 text-center">
          <span className="material-symbols-outlined text-[64px] text-text-muted opacity-20">
            cloud_off
          </span>
          <h3 className="mt-4 text-lg font-semibold text-text-primary">
            No Providers Connected
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-text-muted">
            Connect to providers with OAuth to track your API quota limits and
            usage.
          </p>
        </div>
      </Card>
    );
  }

  let emptyState = {
    icon: "filter_alt_off",
    title: "No Accounts On This Page",
    description:
      "Try moving to another page or refreshing the current filters.",
  };
  if (!totals.eligibleConnections) {
    emptyState = {
      icon: "cloud_off",
      title: "No Providers Connected",
      description:
        "Connect to providers with OAuth to track your API quota limits and usage.",
    };
  } else if (searchQuery && !hasVisibleConnections) {
    emptyState = {
      icon: "search_off",
      title: "No Accounts Match Search",
      description: `No accounts found for “${searchQuery}”. Try a different name or email.`,
    };
  } else if (!totals.providerFilteredConnections) {
    emptyState = {
      icon: "filter_alt_off",
      title: "No Accounts Match Current Filters",
      description:
        providerFilter === "all"
          ? "Try changing the account status filter to see more quota trackers."
          : `No ${accountFilter === "inactive" ? "turned off" : accountFilter === "active" ? "active" : "matching"} accounts found for ${providerFilter}.`,
    };
  }

  const applyPageSize = () => {
    const parsedValue = Number.parseInt(customPageSizeInput, 10);
    if (!Number.isFinite(parsedValue)) {
      setCustomPageSizeInput(String(pageSize));
      return;
    }
    const nextPageSize = Math.min(
      ACCOUNT_PAGE_SIZE_MAX,
      Math.max(1, parsedValue),
    );
    setPage(1);
    setPageSize(nextPageSize);
    setCustomPageSizeInput(String(nextPageSize));
  };

  return (
    <div className="space-y-6">
      <ProviderLimitsHeader
        providerFilter={providerFilter}
        setProviderFilter={setProviderFilter}
        providerMenuOpen={providerMenuOpen}
        setProviderMenuOpen={setProviderMenuOpen}
        providerOptions={providerOptions}
        accountFilter={accountFilter}
        setAccountFilter={setAccountFilter}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        quotaSortMode={quotaSortMode}
        setQuotaSortMode={setQuotaSortMode}
        expiringFirst={expiringFirst}
        setExpiringFirst={setExpiringFirst}
        bulkToggling={bulkToggling}
        handleDisableDepleted={handleDisableDepleted}
        handleEnableAvailable={handleEnableAvailable}
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
        countdown={countdown}
        refreshingAll={refreshingAll}
        refreshAll={refreshAll}
        setPage={setPage}
      />

      {expiringFirst && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Expiring-first currently reorders accounts inside the current page.
          Cross-page ordering still follows backend pagination.
        </div>
      )}

      {hasVisibleConnections ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {sortedConnections.map((conn) => (
            <ProviderConnectionCard
              key={conn.id}
              conn={conn}
              quota={quotaData[conn.id]}
              isLoading={loading[conn.id]}
              error={errors[conn.id]}
              deletingId={deletingId}
              togglingId={togglingId}
              copied={copied}
              copy={copy}
              handleViewCodexResetCredits={handleViewCodexResetCredits}
              onRequestCodexReset={(connection, resetCreditCount) =>
                setResetConfirmState({ connection, resetCreditCount })
              }
              resettingLimitId={resettingLimitId}
              autoPingSaving={autoPingSavingId === conn.id}
              autoPingEnabled={autoPingMaps[conn.provider]?.[conn.id] === true}
              onToggleAutoPing={toggleAutoPing}
              refreshProvider={refreshProvider}
              setSelectedConnection={setSelectedConnection}
              setShowEditModal={setShowEditModal}
              handleDeleteConnection={handleDeleteConnection}
              handleToggleConnectionActive={handleToggleConnectionActive}
              quotaSortMode={quotaSortMode}
            />
          ))}
        </div>
      ) : (
        <Card padding="lg">
          <div className="py-12 text-center">
            <span className="material-symbols-outlined text-[64px] text-text-muted opacity-20">
              {emptyState.icon}
            </span>
            <h3 className="mt-4 text-lg font-semibold text-text-primary">
              {emptyState.title}
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-text-muted">
              {emptyState.description}
            </p>
          </div>
        </Card>
      )}

      <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-text-muted">
            {connectionsPageSummary}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={isCustomPageSize ? "custom" : String(pageSize)}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (nextValue === "custom") return;
                const nextPageSize = Number.parseInt(nextValue, 10);
                if (Number.isFinite(nextPageSize)) {
                  setPage(1);
                  setPageSize(nextPageSize);
                  setCustomPageSizeInput(String(nextPageSize));
                }
              }}
              className="h-8 rounded-lg border border-black/10 bg-black/[0.02] px-2 text-xs text-text-primary outline-none dark:border-white/10 dark:bg-white/[0.03]"
              aria-label="Accounts per page"
            >
              {ACCOUNT_PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={String(option)}>
                  {option} / page
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
            <input
              type="number"
              min="1"
              max={String(ACCOUNT_PAGE_SIZE_MAX)}
              inputMode="numeric"
              value={customPageSizeInput}
              onChange={(event) => setCustomPageSizeInput(event.target.value)}
              onBlur={applyPageSize}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyPageSize();
              }}
              className="h-8 w-20 rounded-lg border border-black/10 bg-black/[0.02] px-2 text-xs text-text-primary outline-none dark:border-white/10 dark:bg-white/[0.03]"
              aria-label="Custom accounts per page"
              placeholder="Custom"
            />
            <span className="text-xs text-text-muted">
              {pageSizeLabel} · Page {pagination.page} / {pagination.totalPages}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={
                pagination.page <= 1 || connectionsLoading || refreshingAll
              }
              className="flex h-8 items-center rounded-lg border border-black/10 px-3 text-xs text-text-primary disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10"
            >
              First Page
            </button>
            <button
              type="button"
              onClick={() =>
                setPage((currentPage) => Math.max(1, currentPage - 1))
              }
              disabled={
                pagination.page <= 1 || connectionsLoading || refreshingAll
              }
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 text-text-primary disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10"
              aria-label="Previous accounts page"
            >
              <span className="material-symbols-outlined text-[16px]">
                chevron_left
              </span>
            </button>
            <button
              type="button"
              onClick={() =>
                setPage((currentPage) =>
                  Math.min(pagination.totalPages, currentPage + 1),
                )
              }
              disabled={
                pagination.page >= pagination.totalPages ||
                connectionsLoading ||
                refreshingAll
              }
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 text-text-primary disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10"
              aria-label="Next accounts page"
            >
              <span className="material-symbols-outlined text-[16px]">
                chevron_right
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPage(pagination.totalPages)}
              disabled={
                pagination.page >= pagination.totalPages ||
                connectionsLoading ||
                refreshingAll
              }
              className="flex h-8 items-center rounded-lg border border-black/10 px-3 text-xs text-text-primary disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10"
            >
              Last Page
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={Boolean(resetConfirmState)}
        onClose={() => {
          if (!resettingLimitId) setResetConfirmState(null);
        }}
        onConfirm={async () => {
          const connection = resetConfirmState?.connection;
          if (!connection) return;
          await handleResetCodexLimit(connection);
          setResetConfirmState(null);
        }}
        title="Reset Codex limit?"
        message={`Use 1 Codex reset credit for ${resetConfirmState?.connection?.email || resetConfirmState?.connection?.name || "this account"}. This cannot be undone. Remaining credits: ${resetConfirmState?.resetCreditCount ?? 0}.`}
        confirmText="Reset limit"
        cancelText="Cancel"
        variant="danger"
        loading={Boolean(resettingLimitId)}
      />
      <CodexResetCreditsModal
        resetCreditsState={resetCreditsState}
        setResetCreditsState={setResetCreditsState}
      />
      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => {
          setShowEditModal(false);
          setSelectedConnection(null);
        }}
      />
    </div>
  );
}
