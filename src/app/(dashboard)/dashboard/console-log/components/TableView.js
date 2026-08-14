"use client";

import { useState } from "react";
import { Badge, Modal } from "@/shared/components";

export default function TableView({ groups, onIdClick }) {
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleCopyDetail = () => {
    if (!selectedGroup) return;
    const raw = selectedGroup.lines.map((l) => l.raw).join("\n");
    navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!groups || groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-text-muted border border-dashed border-border rounded-xl">
        <span className="material-symbols-outlined text-[36px] mb-2 opacity-50">
          table_chart
        </span>
        <p className="text-sm font-medium">Chưa có dữ liệu bảng log</p>
        <p className="text-xs opacity-70">Các request API sẽ được tự động liệt kê tại đây</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Table Container */}
      <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-border bg-surface/40">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="sticky top-0 bg-sidebar z-10">
            <tr className="border-b border-border text-text-muted font-medium">
              <th className="py-2.5 px-3">Thời gian</th>
              <th className="py-2.5 px-3">Request ID</th>
              <th className="py-2.5 px-3">Model / Routing</th>
              <th className="py-2.5 px-3">Tài khoản</th>
              <th className="py-2.5 px-3">Tokens (In / Out)</th>
              <th className="py-2.5 px-3">Cache Hit</th>
              <th className="py-2.5 px-3">Thời gian / TTFT</th>
              <th className="py-2.5 px-3 text-right">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40 font-mono">
            {groups.map((group) => {
              const isSuccess = group.status === "success" && !group.hasError;
              const isError = group.hasError || group.status === "error";

              return (
                <tr
                  key={group.id}
                  onClick={() => setSelectedGroup(group)}
                  className={`hover:bg-sidebar/80 transition-colors cursor-pointer ${
                    isError ? "bg-red-500/5 hover:bg-red-500/10" : ""
                  }`}
                >
                  {/* Timestamp */}
                  <td className="py-2.5 px-3 text-text-muted whitespace-nowrap">
                    {group.startTime}
                  </td>

                  {/* Request ID */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        onIdClick?.(group.id);
                      }}
                      className="font-bold text-primary bg-sidebar px-1.5 py-0.5 rounded border border-border hover:border-primary transition-colors"
                      title="Lọc theo ID"
                    >
                      {group.id}
                      {group.connId ? `:${group.connId}` : ""}
                    </span>
                  </td>

                  {/* Model */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {group.model ? (
                      <span className="font-bold text-orange-400">
                        {group.model}
                      </span>
                    ) : group.combo ? (
                      <span className="text-text-main">{group.combo}</span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>

                  {/* Account */}
                  <td className="py-2.5 px-3 text-text-muted truncate max-w-[160px] whitespace-nowrap">
                    {group.account ? (
                      <span title={group.account}>{group.account}</span>
                    ) : (
                      "—"
                    )}
                  </td>

                  {/* Tokens */}
                  <td className="py-2.5 px-3 whitespace-nowrap text-text-muted">
                    {group.tokensIn != null ? (
                      <span>
                        <strong className="text-text-main">
                          {group.tokensIn >= 1000
                            ? `${(group.tokensIn / 1000).toFixed(1)}k`
                            : group.tokensIn}
                        </strong>
                        {group.tokensOut != null && ` / ${group.tokensOut}`}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>

                  {/* Cache Read % */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {group.cachePct != null && group.cachePct > 0 ? (
                      <span className="font-bold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                        ⚡ {group.cachePct.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-text-muted/60">0%</span>
                    )}
                  </td>

                  {/* Latency / TTFT */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {group.duration != null ? (
                      <span>
                        {(group.duration / 1000).toFixed(2)}s
                        {group.ttft != null && (
                          <span className="text-text-muted text-[10px] ml-1">
                            ({(group.ttft / 1000).toFixed(2)}s)
                          </span>
                        )}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>

                  {/* Status */}
                  <td className="py-2.5 px-3 whitespace-nowrap text-right">
                    {isError ? (
                      <Badge variant="error" size="sm" dot>
                        Error
                      </Badge>
                    ) : isSuccess ? (
                      <Badge variant="success" size="sm" dot>
                        200 OK
                      </Badge>
                    ) : (
                      <Badge variant="primary" size="sm" dot>
                        Stream
                      </Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Detail Slide-over / Modal */}
      {selectedGroup && (
        <Modal
          isOpen={!!selectedGroup}
          onClose={() => setSelectedGroup(null)}
          title={`Chi tiết Request [${selectedGroup.id}]`}
          size="4xl"
        >
          <div className="flex flex-col gap-4 font-mono text-xs">
            {/* Quick Metrics Header */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 p-3.5 rounded-xl bg-surface-2 border border-border">
              <div className="min-w-0">
                <span className="text-[10px] text-text-muted font-sans font-medium block">ENDPOINT</span>
                <span className="font-bold text-text-main truncate block" title={`${selectedGroup.method} ${selectedGroup.endpoint}`}>
                  {selectedGroup.method} {selectedGroup.endpoint}
                </span>
              </div>
              <div className="min-w-0">
                <span className="text-[10px] text-text-muted font-sans font-medium block">TARGET MODEL</span>
                <span className="font-bold text-orange-400 truncate block" title={selectedGroup.model || "Default"}>
                  {selectedGroup.model || "Default"}
                </span>
              </div>
              <div className="min-w-0">
                <span className="text-[10px] text-text-muted font-sans font-medium block">LATENCY / TTFT</span>
                <span className="font-bold text-text-main truncate block">
                  {selectedGroup.duration ? `${(selectedGroup.duration / 1000).toFixed(2)}s` : "—"}
                  {selectedGroup.ttft ? ` (TTFT ${(selectedGroup.ttft / 1000).toFixed(2)}s)` : ""}
                </span>
              </div>
              <div className="min-w-0">
                <span className="text-[10px] text-text-muted font-sans font-medium block">CACHE HIT</span>
                <span className="font-bold text-emerald-500 block">
                  {selectedGroup.cachePct ? `${selectedGroup.cachePct.toFixed(1)}%` : "0%"}
                </span>
              </div>
            </div>

            {/* Step-by-Step Raw Trace Lines */}
            <div className="flex flex-col gap-1.5 max-h-[460px] overflow-y-auto overflow-x-auto bg-black/90 rounded-xl p-4 border border-border font-mono text-xs select-text">
              {selectedGroup.lines.map((l, i) => (
                <div key={i} className="flex items-start gap-2.5 leading-relaxed whitespace-pre hover:bg-white/[0.03] px-1 rounded transition-colors">
                  <span className="text-text-muted/50 select-none shrink-0 font-mono">{l.timestamp}</span>
                  <span className="text-slate-200">{l.text}</span>
                </div>
              ))}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-text-muted font-sans">
                Tài khoản: <strong>{selectedGroup.account || "N/A"}</strong>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyDetail}
                  className="px-3 py-1.5 rounded-lg border border-border hover:bg-sidebar text-text-main font-sans text-xs flex items-center gap-1.5 transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {copied ? "check" : "content_copy"}
                  </span>
                  {copied ? "Đã copy" : "Copy Raw Log"}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
