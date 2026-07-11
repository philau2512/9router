import { useState, useEffect, useRef } from "react";
import { Button, Toggle } from "@/shared/components";

const ACCOUNT_STATUS_FILTERS = [
  { value: "all", label: "All accounts" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Turned off" },
];

export default function ProviderConnectionsToolbar({
  connectionsCount,
  providerId,
  allSelected,
  selectionSummary,
  selectedConnectionIds,
  accountStatusFilter,
  onAccountStatusFilterChange,
  manualRefreshing,
  selectedEmailSummary,
  toggleSelectAllConnections,
  setSelectedConnectionsAutoRefresh,
  handleManualRefreshSelected,
  copySelectedEmails,
  copySelectedNames,
  handleToggleActiveSelected,
  handleSetAllSelectedActive,
  clearSelection,
  clearManualRefreshResults,
  manualRefreshSummary,
  isConnectionsSortActive,
  connectionsSortDirection,
  handleToggleConnectionsSort,
  handleAutoPriorityVisibleConnections,
  onConfirmDeleteSelectedConnections,
  onClearSelectedErrors,
  hasErroredSelection,
  oneByOneRunning,
  oneByOneStopping,
  handleRunOneByOneTest,
  handleStopOneByOneTest,
  proxyPoolsLength,
  openBulkProxyModal,
  providerStrategy,
  handleRoundRobinToggle,
  providerStickyLimit,
  handleStickyLimitChange,
  warmupRunning,
  warmupSummary,
  handleWarmupSelected,
  clearWarmupResults,
}) {
  const hasConnections = connectionsCount > 0;
  const hasSelection = selectedConnectionIds.length > 0;

  const [showCopyDropdown, setShowCopyDropdown] = useState(false);
  const [showMoreDropdown, setShowMoreDropdown] = useState(false);
  const copyDropdownRef = useRef(null);
  const moreDropdownRef = useRef(null);

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        copyDropdownRef.current &&
        !copyDropdownRef.current.contains(event.target)
      ) {
        setShowCopyDropdown(false);
      }
      if (
        moreDropdownRef.current &&
        !moreDropdownRef.current.contains(event.target)
      ) {
        setShowMoreDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div className="mb-4 flex flex-col gap-3">
      {/* Row 1: Header, Filters, Settings & Routing */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="text-lg font-semibold">Connections</h2>
        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
          {/* Filters & Sorting */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-muted">View</span>
            <select
              value={accountStatusFilter}
              onChange={(event) =>
                onAccountStatusFilterChange(event.target.value)
              }
              disabled={!hasConnections}
              className="h-7 rounded-[8px] border border-border bg-surface-2 px-2 text-xs text-text-main outline-none transition-colors hover:bg-surface-3 disabled:opacity-50"
              aria-label="Filter accounts by status"
            >
              {ACCOUNT_STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <Button
            size="sm"
            variant={isConnectionsSortActive ? "secondary" : "ghost"}
            icon="schedule"
            onClick={handleToggleConnectionsSort}
            disabled={!hasConnections}
          >
            {connectionsSortDirection === "asc"
              ? "Expire at ↑"
              : connectionsSortDirection === "desc"
                ? "Expire at ↓"
                : "Sort Expire at"}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            icon="low_priority"
            onClick={handleAutoPriorityVisibleConnections}
            disabled={!hasConnections}
          >
            Auto priority
          </Button>

          {connectionsCount > 0 && providerId === "codex" && (
            <Button
              size="sm"
              variant="secondary"
              icon="sync"
              onClick={handleRunOneByOneTest}
              disabled={oneByOneRunning}
            >
              {oneByOneRunning
                ? "Testing One-by-One..."
                : "Test One-by-One"}
            </Button>
          )}
          {providerId === "codex" && oneByOneRunning && (
            <Button
              size="sm"
              variant="ghost"
              icon="stop"
              onClick={handleStopOneByOneTest}
              disabled={oneByOneStopping}
            >
              {oneByOneStopping ? "Stopping..." : "Stop"}
            </Button>
          )}

          {connectionsCount > 0 && proxyPoolsLength > 0 && (
            <Button
              size="sm"
              variant="secondary"
              icon="lan"
              onClick={openBulkProxyModal}
            >
              Apply Proxy (all)
            </Button>
          )}

          {/* Routing Configuration */}
          <div className="flex items-center gap-2 rounded-[8px] border border-border bg-surface-2 px-3 py-0.5 h-7">
            <span className="text-xs font-medium text-text-muted">
              Round Robin
            </span>
            <Toggle
              checked={providerStrategy === "round-robin"}
              onChange={handleRoundRobinToggle}
            />
            {providerStrategy === "round-robin" && (
              <div className="flex items-center gap-1.5 border-l border-border pl-2 ml-1">
                <span className="text-[11px] text-text-muted">Sticky:</span>
                <input
                  type="number"
                  min={1}
                  value={providerStickyLimit}
                  onChange={(e) => handleStickyLimitChange(e.target.value)}
                  placeholder="1"
                  className="w-10 rounded-md border border-border bg-background px-1 py-0.5 text-center text-xs focus:border-primary focus:outline-none"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Bulk Actions - Only visible when accounts are selected */}
      {hasConnections && hasSelection && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-500/20 bg-brand-500/[0.04] p-3 shadow-sm transition-all duration-300 dark:border-brand-500/10 dark:bg-brand-500/[0.02]">
          {/* Selection details & Checkbox */}
          <div className="flex items-center gap-3">
            <label className="flex h-7 items-center gap-2 rounded-[8px] border border-border bg-surface-2/65 px-3 text-xs font-medium text-text-main cursor-pointer hover:bg-surface-3 transition-colors">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAllConnections}
                className="rounded border-border text-brand-500 focus:ring-brand-500 cursor-pointer"
              />
              <span>Select all ({selectionSummary})</span>
            </label>
          </div>

          {/* Action buttons list */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Quick Actions */}
            <Button
              size="sm"
              variant="success"
              icon="toggle_on"
              onClick={() => handleToggleActiveSelected(true)}
              title="Turn on selected connections"
            >
              Turn on
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="toggle_off"
              onClick={() => handleToggleActiveSelected(false)}
              title="Turn off selected connections"
            >
              Turn off
            </Button>

            {/* Copy Dropdown Menu */}
            <div className="relative" ref={copyDropdownRef}>
              <Button
                size="sm"
                variant="ghost"
                icon="content_copy"
                iconRight="arrow_drop_down"
                onClick={() => setShowCopyDropdown((prev) => !prev)}
              >
                Copy
              </Button>
              {showCopyDropdown && (
                <div className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-border bg-bg py-1 shadow-lg">
                  <button
                    onClick={() => {
                      copySelectedEmails();
                      setShowCopyDropdown(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-text-main hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[16px] text-text-muted">
                      mail
                    </span>
                    Copy Emails ({selectedEmailSummary})
                  </button>
                  <button
                    onClick={() => {
                      copySelectedNames();
                      setShowCopyDropdown(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-text-main hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[16px] text-text-muted">
                      person
                    </span>
                    Copy Names
                  </button>
                </div>
              )}
            </div>

            {/* Delete (Red Warning Button) */}
            <Button
              size="sm"
              variant="ghost"
              icon="delete"
              onClick={onConfirmDeleteSelectedConnections}
              className="text-red-500 hover:bg-red-500/10 hover:text-red-600 font-semibold"
            >
              Delete
            </Button>

            {/* More Actions Dropdown */}
            <div className="relative" ref={moreDropdownRef}>
              <Button
                size="sm"
                variant="ghost"
                icon="more_horiz"
                iconRight="arrow_drop_down"
                onClick={() => setShowMoreDropdown((prev) => !prev)}
              >
                More
              </Button>
              {showMoreDropdown && (
                <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-border bg-bg py-1 shadow-lg">
                  {/* Warmup action */}
                  <button
                    onClick={() => {
                      handleWarmupSelected();
                      setShowMoreDropdown(false);
                    }}
                    disabled={warmupRunning}
                    className="w-full text-left px-3 py-2 text-xs text-orange-500 hover:bg-orange-500/10 flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      local_fire_department
                    </span>
                    {warmupRunning ? "Warming up..." : "Warmup Selected"}
                  </button>

                  {/* Set testStatus to Active */}
                  <button
                    onClick={() => {
                      handleSetAllSelectedActive();
                      setShowMoreDropdown(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-text-main hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[16px] text-green-500">
                      check_circle
                    </span>
                    Set Status Active
                  </button>

                  {/* Auto Refresh Toggle for Codex */}
                  {providerId === "codex" && (
                    <>
                      <button
                        onClick={() => {
                          setSelectedConnectionsAutoRefresh(true);
                          setShowMoreDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs text-text-main hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined text-[16px] text-text-muted">
                          sync
                        </span>
                        Enable Auto Refresh
                      </button>
                      <button
                        onClick={() => {
                          setSelectedConnectionsAutoRefresh(false);
                          setShowMoreDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs text-text-main hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined text-[16px] text-text-muted">
                          sync_disabled
                        </span>
                        Disable Auto Refresh
                      </button>
                      <button
                        onClick={() => {
                          handleManualRefreshSelected();
                          setShowMoreDropdown(false);
                        }}
                        disabled={manualRefreshing}
                        className="w-full text-left px-3 py-2 text-xs text-text-main hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined text-[16px] text-text-muted">
                          refresh
                        </span>
                        Refresh Selected Now
                      </button>
                    </>
                  )}

                  {/* Clear error log */}
                  <button
                    onClick={() => {
                      onClearSelectedErrors();
                      setShowMoreDropdown(false);
                    }}
                    disabled={!hasErroredSelection}
                    className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-red-500/10 disabled:opacity-50 flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      clear_all
                    </span>
                    Clear Errors
                  </button>
                </div>
              )}
            </div>

            {/* Unselect/Clear */}
            <div className="border-l border-border pl-2 ml-1">
              <Button
                size="sm"
                variant="ghost"
                icon="close"
                onClick={() => {
                  clearSelection();
                  clearManualRefreshResults();
                  clearWarmupResults?.();
                }}
                title="Deselect all"
              >
                Clear
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
