import { Modal, Button, Input } from "@/shared/components";

export function PxpipeSetupModal({
  isOpen,
  onClose,
  pxpipeStatus,
  pxpipeStatusLabel,
  pxpipeHealthy,
  pxpipeHealth,
  pxpipeAction,
  pxpipeActionLoading,
  pxpipeActionError,
  pxpipeMinChars,
  setPxpipeMinChars,
  handlePxpipeMinCharsBlur,
  refreshPxpipeStatus,
  runPxpipeHealth,
}) {
  return (
    <Modal
      isOpen={isOpen}
      title={pxpipeStatus.installed ? "PXPIPE" : "Setup PXPIPE"}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          Compress prompts using multimodal encoding. Runs in-process — no
          extra server or environment variables required.
        </p>
        <div className="flex items-center justify-between text-sm">
          <span>Status</span>
          <span
            className={
              pxpipeHealthy || pxpipeStatus.running
                ? "text-success"
                : "text-warning"
            }
          >
            {pxpipeStatusLabel}
            {pxpipeStatus.version ? ` · v${pxpipeStatus.version}` : ""}
          </span>
        </div>
        {pxpipeHealth?.checks?.length > 0 && (
          <div className="flex flex-col gap-1 rounded border border-border p-3">
            <p className="text-sm font-medium mb-1">Health check</p>
            {pxpipeHealth.checks.map((check) => (
              <div
                key={check.id}
                className="flex items-center justify-between text-xs"
              >
                <span className={check.ok ? "text-success" : "text-warning"}>
                  {check.ok ? "●" : "○"} {check.label}
                </span>
                {check.detail && (
                  <span className="text-text-muted font-mono truncate max-w-[50%]">
                    {check.detail}
                  </span>
                )}
              </div>
            ))}
            {pxpipeHealth.error && (
              <p className="text-xs text-warning mt-1 text-left">
                {pxpipeHealth.error}
              </p>
            )}
          </div>
        )}
        {!pxpipeStatus.installed ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-warning">PXPIPE is not installed.</p>
            <Button
              onClick={() => pxpipeAction("install")}
              fullWidth
              disabled={pxpipeActionLoading || pxpipeStatus.installing}
            >
              {pxpipeActionLoading || pxpipeStatus.installing
                ? "Installing…"
                : "Install"}
            </Button>
            <p className="text-xs text-text-muted">
              Installs the npm package{" "}
              <code className="font-mono">pxpipe-proxy</code> into the 9Router
              data directory. May take a few minutes.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {pxpipeStatus.running ? (
              <>
                <Button
                  onClick={() => pxpipeAction("restart")}
                  variant="ghost"
                  disabled={pxpipeActionLoading}
                >
                  Restart
                </Button>
                <Button
                  onClick={() => pxpipeAction("stop")}
                  variant="ghost"
                  disabled={pxpipeActionLoading}
                >
                  Stop
                </Button>
              </>
            ) : (
              <Button
                onClick={() => pxpipeAction("start")}
                disabled={pxpipeActionLoading}
              >
                {pxpipeActionLoading ? "Starting…" : "Start"}
              </Button>
            )}
            <Button
              onClick={() => pxpipeAction("install")}
              variant="ghost"
              disabled={pxpipeActionLoading}
            >
              Repair
            </Button>
            <a
              href="/dashboard/pxpipe#logs"
              className="col-span-2 rounded border border-border px-4 py-2 text-center text-sm hover:bg-surface-2"
            >
              Open Logs
            </a>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Minimum prompt size (chars)</p>
          <Input
            value={String(pxpipeMinChars)}
            onChange={(e) => setPxpipeMinChars(e.target.value)}
            onBlur={handlePxpipeMinCharsBlur}
            placeholder="25000"
            className="font-mono text-sm"
          />
          <p className="text-xs text-text-muted">
            Requests smaller than this bypass PXPIPE and are sent as-is.
          </p>
        </div>
        {pxpipeActionError && (
          <p className="text-sm text-warning">{pxpipeActionError}</p>
        )}
        <div className="flex gap-2">
          <Button
            onClick={() => refreshPxpipeStatus().then(runPxpipeHealth)}
            variant="ghost"
            fullWidth
          >
            Recheck
          </Button>
          <Button onClick={onClose} fullWidth>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}