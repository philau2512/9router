"use client";

import { cn } from "@/shared/utils/cn";

export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  className,
}) {
  const sizes = {
    sm: "h-7 text-xs",
    md: "h-9 text-sm",
    lg: "h-11 text-base",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center p-1 rounded-[10px] overflow-x-auto",
        "bg-surface-2",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "shrink-0 px-3 rounded-[8px] font-medium transition-all inline-flex items-center justify-center gap-1.5 leading-none select-none",
            sizes[size],
            value === option.value
              ? "bg-surface text-text-main shadow-sm"
              : "text-text-muted hover:text-text-main",
          )}
        >
          {option.icon && (
            <span className="material-symbols-outlined text-[15px] shrink-0 leading-none flex items-center justify-center">
              {option.icon}
            </span>
          )}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
