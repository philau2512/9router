import { Button, Card } from "@/shared/components";

export default function ProviderModelsPanel({
  isCompatible,
  models,
  kiloFreeModels,
  disabledModelIds,
  modelsTestError,
  renderModelsSection,
  handleEnableAll,
  handleDisableAll,
  thinkingMode = "auto",
  onThinkingModeChange,
  thinkingLevelOptions = null,
  onRefreshModels = null,
  isRefreshingModels = false,
}) {
  const allIds = [
    ...models,
    ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
  ]
    .filter((m) => !m.type || m.type === "llm")
    .map((m) => m.id);
  const activeIds = allIds.filter((id) => !disabledModelIds.includes(id));

  return (
    <Card>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">{"Available Models"}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {!isCompatible && onRefreshModels && (
            <Button
              size="sm"
              variant="secondary"
              icon="refresh"
              onClick={onRefreshModels}
              loading={isRefreshingModels}
              title="Bypass 5-minute cache and fetch live models from Provider API"
            >
              Refresh Models
            </Button>
          )}
          {!isCompatible && thinkingLevelOptions?.length > 0 && onThinkingModeChange && (
            <select
              value={thinkingMode || "auto"}
              onChange={(e) => onThinkingModeChange(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-main"
              title="Default thinking level appended as model(level) when copying"
            >
              {thinkingLevelOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {`Thinking: ${opt.charAt(0).toUpperCase() + opt.slice(1)}`}
                </option>
              ))}
            </select>
          )}
          {!isCompatible && (
            <>
              {disabledModelIds.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="restart_alt"
                  onClick={handleEnableAll}
                >
                  Active All
                </Button>
              )}
              {activeIds.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="block"
                  onClick={() => handleDisableAll(activeIds)}
                >
                  Disable All
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {!!modelsTestError && (
        <p className="mb-3 break-words text-xs text-red-500">
          {modelsTestError}
        </p>
      )}
      {renderModelsSection()}
    </Card>
  );
}