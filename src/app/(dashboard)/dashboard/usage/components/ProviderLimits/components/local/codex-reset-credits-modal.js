"use client";

import { formatTimeRemaining, formatCreditDate } from "./helpers";

export default function CodexResetCreditsModal({
  resetCreditsState,
  setResetCreditsState,
}) {
  if (!resetCreditsState) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => setResetCreditsState(null)}
    >
      <div
        className="relative w-full max-w-md rounded-xl border border-black/10 bg-white p-5 shadow-xl dark:border-white/10 dark:bg-[#1a1a1a]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-primary">
            Codex Reset Credits
          </h3>
          <button
            type="button"
            onClick={() => setResetCreditsState(null)}
            className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-text-muted"
          >
            <span className="material-symbols-outlined text-[18px]">
              close
            </span>
          </button>
        </div>
        {resetCreditsState.loading && (
          <div className="flex items-center justify-center py-8 text-text-muted text-sm gap-2">
            <span className="material-symbols-outlined text-[18px] animate-spin">
              progress_activity
            </span>
            Loading...
          </div>
        )}
        {resetCreditsState.error && (
          <div className="text-sm text-red-600 dark:text-red-400 py-4 text-center">
            {resetCreditsState.error}
          </div>
        )}
        {resetCreditsState.data && (
          <div>
            <p className="text-xs text-text-muted mb-3">
              Available:{" "}
              <span className="font-semibold text-text-primary">
                {resetCreditsState.data.availableCount}
              </span>
            </p>
            {resetCreditsState.data.credits.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-4">
                No credits found.
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {resetCreditsState.data.credits.map((credit, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`font-medium capitalize ${credit.status === "active" ? "text-green-600 dark:text-green-400" : "text-text-muted"}`}
                      >
                        {credit.status}
                      </span>
                      <span className="text-text-muted">
                        {formatTimeRemaining(credit.expiresAt)}
                      </span>
                    </div>
                    <div className="mt-1 text-text-muted space-y-0.5">
                      <div>
                        Granted: {formatCreditDate(credit.grantedAt)}
                      </div>
                      <div>
                        Expires: {formatCreditDate(credit.expiresAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}