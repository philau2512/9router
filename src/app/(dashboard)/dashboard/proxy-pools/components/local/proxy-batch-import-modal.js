import { Button, Modal } from "@/shared/components";

export default function ProxyBatchImportModal({
  isOpen,
  onClose,
  batchImportText,
  setBatchImportText,
  handleBatchImport,
  importing,
}) {
  return (
    <Modal
      isOpen={isOpen}
      title="Batch Import Proxies"
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium text-text-main mb-1 block">
            Paste Proxy List (One per line)
          </label>
          <textarea
            value={batchImportText}
            onChange={(e) => setBatchImportText(e.target.value)}
            placeholder={
              "http://user:pass@127.0.0.1:7897\n127.0.0.1:7897:user:pass"
            }
            className="w-full min-h-[180px] py-2 px-3 text-sm text-text-main bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-md focus:ring-1 focus:ring-primary/30 focus:border-primary/50 focus:outline-none transition-all"
          />
          <p className="text-xs text-text-muted mt-1">
            Supported formats: protocol://user:pass@host:port,
            host:port:user:pass
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            fullWidth
            onClick={handleBatchImport}
            disabled={!batchImportText.trim() || importing}
          >
            {importing ? "Importing..." : "Import"}
          </Button>
          <Button
            fullWidth
            variant="ghost"
            onClick={onClose}
            disabled={importing}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}