import PropTypes from "prop-types";
import { CapacityBadges } from "@/shared/components";

function formatContextLength(value) {
  if (value == null) return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;

  if (num >= 1000000) {
    const val = num / 1000000;
    return `${Number.isInteger(val) ? val : val.toFixed(1)}M`;
  }
  if (num >= 1000) {
    const val = num / 1000;
    return `${Number.isInteger(val) ? val : val.toFixed(1)}K`;
  }
  return num.toString();
}

export default function ModelRow({
  model,
  fullModel,
  alias,
  copied,
  onCopy,
  testStatus,
  isCustom,
  isFree,
  onDeleteAlias,
  onTest,
  isTesting,
  onDisable,
  caps,
  thinkingSuffix,
}) {
  const displayModel = thinkingSuffix
    ? `${fullModel}(${thinkingSuffix})`
    : fullModel;
  const borderColor =
    testStatus === "ok"
      ? "border-green-500/40"
      : testStatus === "error"
        ? "border-red-500/40"
        : "border-border";

  const iconColor =
    testStatus === "ok"
      ? "#22c55e"
      : testStatus === "error"
        ? "#ef4444"
        : undefined;

  const rawContext = model.context_length ?? model.contextLength;
  const contextDisplay = formatContextLength(rawContext);

  return (
    <div
      className={`group min-w-0 max-w-full rounded-lg border px-3 py-2 ${borderColor} hover:bg-sidebar/50`}
    >
      <div className="flex min-w-0 items-start gap-2 sm:items-center">
        <span
          className="material-symbols-outlined shrink-0 text-base"
          style={iconColor ? { color: iconColor } : undefined}
        >
          {testStatus === "ok"
            ? "check_circle"
            : testStatus === "error"
              ? "cancel"
              : "smart_toy"}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <code className="max-w-[72vw] truncate rounded bg-sidebar px-1.5 py-0.5 font-mono text-xs text-text-muted sm:max-w-[360px]">
            {displayModel}
          </code>
          <span className="flex min-w-0 items-center gap-1 pl-1 text-[9px]">
            {model.name && (
              <span className="truncate italic text-text-muted/70">
                {model.name}
              </span>
            )}
            {model.isLive ? (
              <span
                className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/10 px-1 py-0.2 font-mono text-[8px] font-semibold text-emerald-600 dark:text-emerald-400"
                title="Model được fetch động trực tiếp từ API của Provider"
              >
                API
              </span>
            ) : (
              <span
                className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1 py-0.2 font-mono text-[8px] font-semibold text-amber-600 dark:text-amber-400"
                title="Model mặc định từ danh mục tĩnh (Static Catalog)"
              >
                Static
              </span>
            )}
            <CapacityBadges
              caps={caps}
              colorOverride="text-text-muted/70"
              size={12}
            />
          </span>
          {contextDisplay && (
            <span className="pl-1 text-[9px] font-medium text-text-muted/60">
              Context: {contextDisplay}
            </span>
          )}
        </div>
        {onTest && (
          <div className="relative shrink-0 group/btn">
            <button
              onClick={onTest}
              disabled={isTesting}
              className={`rounded p-0.5 text-text-muted transition-opacity hover:bg-sidebar hover:text-primary ${isTesting ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"}`}
            >
              <span
                className="material-symbols-outlined text-sm"
                style={
                  isTesting
                    ? { animation: "spin 1s linear infinite" }
                    : undefined
                }
              >
                {isTesting ? "progress_activity" : "science"}
              </span>
            </button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isTesting ? "Testing..." : "Test"}
            </span>
          </div>
        )}
        <div className="relative shrink-0 group/btn">
          <button
            onClick={() => onCopy(displayModel, `model-${model.id}`)}
            className="rounded p-0.5 text-text-muted hover:bg-sidebar hover:text-primary"
          >
            <span className="material-symbols-outlined text-sm">
              {copied === `model-${model.id}` ? "check" : "content_copy"}
            </span>
          </button>
          <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
            {copied === `model-${model.id}` ? "Copied!" : "Copy"}
          </span>
        </div>
        {isCustom ? (
          <button
            onClick={onDeleteAlias}
            className="ml-auto rounded p-0.5 text-text-muted opacity-100 transition-opacity hover:bg-red-500/10 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
            title="Remove custom model"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        ) : onDisable ? (
          <button
            onClick={onDisable}
            className="ml-auto rounded p-0.5 text-text-muted opacity-100 transition-opacity hover:bg-red-500/10 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
            title="Disable this model"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes.shape({
    id: PropTypes.string.isRequired,
  }).isRequired,
  fullModel: PropTypes.string.isRequired,
  alias: PropTypes.string,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isCustom: PropTypes.bool,
  isFree: PropTypes.bool,
  onDeleteAlias: PropTypes.func,
  onTest: PropTypes.func,
  isTesting: PropTypes.bool,
  onDisable: PropTypes.func,
  caps: PropTypes.object,
  thinkingSuffix: PropTypes.string,
};
