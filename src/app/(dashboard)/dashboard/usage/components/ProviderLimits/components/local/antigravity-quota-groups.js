"use client";

import Image from "next/image";
import Tooltip from "@/shared/components/Tooltip";
import { formatResetTime } from "../../utils";

function getGroupIcon(groupName = "") {
  const lower = groupName.toLowerCase();
  if (lower.includes("claude") || lower.includes("gpt")) {
    return {
      src: "/providers/claude.png",
      alt: "Claude",
      badge: "Claude / GPT",
    };
  }
  return {
    src: "/providers/gemini.png",
    alt: "Gemini",
    badge: "Gemini",
  };
}

function getProgressColors(percentage) {
  if (percentage > 70) {
    return {
      bar: "bg-green-500",
      bgLight: "bg-green-500/10",
      text: "text-green-600 dark:text-green-400",
    };
  }
  if (percentage >= 30) {
    return {
      bar: "bg-yellow-500",
      bgLight: "bg-yellow-500/10",
      text: "text-yellow-600 dark:text-yellow-400",
    };
  }
  return {
    bar: "bg-red-500",
    bgLight: "bg-red-500/10",
    text: "text-red-600 dark:text-red-400",
  };
}

function getBucketDescription(bucket, percentage) {
  if (bucket.description) {
    return bucket.description;
  }
  const countdown = formatResetTime(bucket.resetAt);
  if (percentage >= 100) {
    return countdown !== "-"
      ? `Full quota available, next refresh in ${countdown}.`
      : "Full quota available.";
  }
  const windowLabel = bucket.window === "weekly" ? "weekly limit" : "5-hour limit";
  return countdown !== "-"
    ? `Used some of ${windowLabel}, fully refreshes in ${countdown}.`
    : `Used some of ${windowLabel}.`;
}

export default function AntigravityQuotaGroups({ quotaGroups }) {
  if (!Array.isArray(quotaGroups) || quotaGroups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 px-1 py-1">
      {quotaGroups.map((group, groupIdx) => {
        const iconInfo = getGroupIcon(group.displayName);

        return (
          <div key={group.displayName || groupIdx} className="space-y-2">
            {/* Header with Group Icon and Name */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-black/5 dark:bg-white/5 overflow-hidden">
                  <Image
                    src={iconInfo.src}
                    alt={iconInfo.alt}
                    width={16}
                    height={16}
                    className="object-contain"
                  />
                </div>
                <span className="text-xs font-semibold text-text-primary truncate">
                  {group.displayName}
                </span>
                {group.description && (
                  <Tooltip text={group.description}>
                    <span className="material-symbols-outlined text-[13px] text-text-muted cursor-help opacity-70 hover:opacity-100">
                      info
                    </span>
                  </Tooltip>
                )}
              </div>
            </div>

            {/* Buckets Card */}
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3 space-y-3 dark:border-white/10 dark:bg-white/[0.02]">
              {Array.isArray(group.buckets) &&
                group.buckets.map((bucket, bucketIdx) => {
                  const percentage = Math.round(
                    (Number(bucket.remainingFraction) || 0) * 100,
                  );
                  const colors = getProgressColors(percentage);
                  const desc = getBucketDescription(bucket, percentage);
                  const bucketTitle =
                    bucket.displayName ||
                    (bucket.window === "weekly"
                      ? "Weekly Limit Remaining"
                      : "5-Hour Limit Remaining");

                  return (
                    <div key={bucket.bucketId || bucketIdx} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-text-primary truncate">
                          {bucketTitle}
                        </span>
                        <span className={`font-semibold tabular-nums shrink-0 ${colors.text}`}>
                          {percentage}%
                        </span>
                      </div>

                      {/* Horizontal progress bar */}
                      <div className={`h-1.5 w-full rounded-full overflow-hidden ${colors.bgLight}`}>
                        <div
                          className={`h-full rounded-full transition-all duration-500 ease-out ${colors.bar}`}
                          style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
                        />
                      </div>

                      <div className="text-[11px] text-text-muted leading-tight">
                        {desc}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        );
      })}
    </div>
  );
}