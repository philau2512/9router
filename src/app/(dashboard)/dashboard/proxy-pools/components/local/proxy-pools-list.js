import { Badge, Button, Card, Toggle } from "@/shared/components";
import { getStatusVariant, formatDateTime } from "./helpers";

export default function ProxyPoolsList({
  proxyPools,
  activeCount,
  allSelected,
  selectedIds,
  healthChecking,
  healthProgress,
  bulkBusy,
  toggleSelectAll,
  toggleSelect,
  handleHealthCheck,
  bulkSetActive,
  bulkDelete,
  clearSelection,
  handleToggleActive,
  handleTest,
  openEditModal,
  handleDelete,
  openCreateModal,
  testingId,
}) {
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {proxyPools.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="size-4 rounded border-black/20 dark:border-white/20"
            />
            {allSelected ? "Unselect all" : "Select all"}
          </label>
        )}
        <Badge variant="default">Total: {proxyPools.length}</Badge>
        <Badge variant="success">Active: {activeCount}</Badge>
      </div>

      {(selectedIds.length > 0 || healthChecking) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="material-symbols-outlined text-[18px] text-primary">
            checklist
          </span>
          <span className="text-xs font-medium text-primary">
            {selectedIds.length > 0
              ? `${selectedIds.length} selected`
              : "All pools"}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              icon={
                healthChecking ? "progress_activity" : "health_and_safety"
              }
              onClick={handleHealthCheck}
              disabled={healthChecking || bulkBusy || proxyPools.length === 0}
            >
              {healthChecking
                ? `Checking ${healthProgress.current}/${healthProgress.total}`
                : "Health Check"}
            </Button>
            {selectedIds.length > 0 && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="toggle_on"
                  onClick={() => bulkSetActive(true)}
                  disabled={bulkBusy || healthChecking}
                >
                  Activate
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="toggle_off"
                  onClick={() => bulkSetActive(false)}
                  disabled={bulkBusy || healthChecking}
                >
                  Deactivate
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="delete"
                  onClick={bulkDelete}
                  disabled={bulkBusy || healthChecking}
                >
                  Delete
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={clearSelection}
                  disabled={bulkBusy || healthChecking}
                >
                  Clear
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {proxyPools.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-text-main font-medium mb-1">
            No proxy pool entries yet
          </p>
          <p className="text-sm text-text-muted mb-4">
            Create a proxy pool entry, then assign it to connections.
          </p>
          <Button icon="add" onClick={openCreateModal}>
            Add Proxy Pool
          </Button>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-black/[0.04] dark:divide-white/[0.05]">
          {proxyPools.map((pool) => (
            <div
              key={pool.id}
              className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(pool.id)}
                  onChange={() => toggleSelect(pool.id)}
                  className="mt-1 size-4 shrink-0 rounded border-black/20 dark:border-white/20"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="min-w-0 max-w-full truncate text-sm font-medium sm:max-w-[18rem]">
                      {pool.name}
                    </p>
                    <Badge
                      variant={getStatusVariant(pool.testStatus)}
                      size="sm"
                      dot
                    >
                      {pool.testStatus || "unknown"}
                    </Badge>
                    <Badge
                      variant={pool.isActive ? "success" : "default"}
                      size="sm"
                    >
                      {pool.isActive ? "active" : "inactive"}
                    </Badge>
                    {pool.type === "vercel" && (
                      <Badge variant="default" size="sm">
                        vercel relay
                      </Badge>
                    )}
                    {pool.type === "cloudflare" && (
                      <Badge variant="default" size="sm">
                        cloudflare relay
                      </Badge>
                    )}
                    <Badge variant="default" size="sm">
                      {pool.boundConnectionCount || 0} bound
                    </Badge>
                  </div>
                  <p className="text-xs text-text-muted truncate mt-1">
                    {pool.proxyUrl}
                  </p>
                  {pool.noProxy ? (
                    <p className="text-xs text-text-muted truncate">
                      No proxy: {pool.noProxy}
                    </p>
                  ) : null}
                  <p className="text-[11px] text-text-muted mt-1">
                    Last tested: {formatDateTime(pool.lastTestedAt)}
                    {pool.lastError ? ` · ${pool.lastError}` : ""}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-1">
                <Toggle
                  size="sm"
                  checked={pool.isActive === true}
                  onChange={() => handleToggleActive(pool)}
                  title={pool.isActive ? "Disable" : "Enable"}
                />
                <button
                  onClick={() => handleTest(pool.id)}
                  className="p-2 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary"
                  title="Test proxy"
                  disabled={testingId === pool.id}
                >
                  <span
                    className="material-symbols-outlined text-[18px]"
                    style={
                      testingId === pool.id
                        ? { animation: "spin 1s linear infinite" }
                        : undefined
                    }
                  >
                    {testingId === pool.id ? "progress_activity" : "science"}
                  </span>
                </button>
                <button
                  onClick={() => openEditModal(pool)}
                  className="p-2 rounded hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary"
                  title="Edit"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    edit
                  </span>
                </button>
                <button
                  onClick={() => handleDelete(pool)}
                  className="p-2 rounded hover:bg-red-500/10 text-red-500"
                  title="Delete"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    delete
                  </span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}