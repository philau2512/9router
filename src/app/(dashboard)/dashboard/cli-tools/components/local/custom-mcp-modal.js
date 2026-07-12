export function CustomMcpModal({
  isOpen,
  onClose,
  addMcpForm,
  setAddMcpForm,
  setCustomPlugins,
}) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl shadow-xl w-full max-w-sm mx-4 p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Add Custom MCP</h3>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-main"
          >
            <span className="material-symbols-outlined text-[18px]">
              close
            </span>
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setAddMcpForm((f) => ({ ...f, type: "url" }))}
            className={`flex-1 py-1.5 rounded border text-xs font-medium transition-colors ${addMcpForm.type === "url" ? "bg-primary/10 border-primary/40 text-primary" : "border-border text-text-muted hover:border-primary/40"}`}
          >
            URL (SSE)
          </button>
          <button
            onClick={() => setAddMcpForm((f) => ({ ...f, type: "cmd" }))}
            className={`flex-1 py-1.5 rounded border text-xs font-medium transition-colors ${addMcpForm.type === "cmd" ? "bg-primary/10 border-primary/40 text-primary" : "border-border text-text-muted hover:border-primary/40"}`}
          >
            Command (stdio)
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-text-muted font-medium">
              Name
            </label>
            <input
              type="text"
              placeholder="my-mcp"
              value={addMcpForm.name}
              onChange={(e) =>
                setAddMcpForm((f) => ({
                  ...f,
                  name: e.target.value.replace(/\s+/g, "-").toLowerCase(),
                }))
              }
              className="px-2 py-1.5 rounded border border-border bg-surface text-xs outline-none focus:border-primary"
            />
          </div>
          {addMcpForm.type === "url" ? (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-muted font-medium">
                SSE URL
              </label>
              <input
                type="text"
                placeholder="https://your-mcp-server.com/sse"
                value={addMcpForm.url}
                onChange={(e) =>
                  setAddMcpForm((f) => ({ ...f, url: e.target.value }))
                }
                className="px-2 py-1.5 rounded border border-border bg-surface text-xs outline-none focus:border-primary"
              />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-muted font-medium">
                  Command
                </label>
                <input
                  type="text"
                  placeholder="npx"
                  value={addMcpForm.command}
                  onChange={(e) =>
                    setAddMcpForm((f) => ({
                      ...f,
                      command: e.target.value,
                    }))
                  }
                  className="px-2 py-1.5 rounded border border-border bg-surface text-xs outline-none focus:border-primary"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-muted font-medium">
                  Args{" "}
                  <span className="font-normal">(comma-separated)</span>
                </label>
                <input
                  type="text"
                  placeholder="-y, @some/mcp-package"
                  value={addMcpForm.args}
                  onChange={(e) =>
                    setAddMcpForm((f) => ({ ...f, args: e.target.value }))
                  }
                  className="px-2 py-1.5 rounded border border-border bg-surface text-xs outline-none focus:border-primary"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded border border-border text-xs text-text-muted hover:bg-surface cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const name = addMcpForm.name.trim();
              if (!name) return;
              if (addMcpForm.type === "url") {
                if (!addMcpForm.url.trim()) return;
                setCustomPlugins((prev) => [
                  ...prev.filter((x) => x.name !== name),
                  {
                    name,
                    url: addMcpForm.url.trim(),
                    transport: "sse",
                    custom: true,
                  },
                ]);
              } else {
                if (!addMcpForm.command.trim()) return;
                const args = addMcpForm.args
                  .split(",")
                  .map((a) => a.trim())
                  .filter(Boolean);
                setCustomPlugins((prev) => [
                  ...prev.filter((x) => x.name !== name),
                  {
                    name,
                    command: addMcpForm.command.trim(),
                    args,
                    custom: true,
                  },
                ]);
              }
              onClose();
            }}
            className="px-3 py-1.5 rounded bg-primary text-white text-xs font-medium hover:opacity-90 cursor-pointer"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}