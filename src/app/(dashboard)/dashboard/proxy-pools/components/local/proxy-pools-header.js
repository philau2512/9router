import { Button } from "@/shared/components";

export default function ProxyPoolsHeader({
  relayMenuRef,
  showRelayMenu,
  setShowRelayMenu,
  openCloudflareModal,
  openVercelModal,
  openDenoModal,
  openBatchImportModal,
  openCreateModal,
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold sm:text-2xl">Proxy Pools</h1>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
        <div className="relative" ref={relayMenuRef}>
          <Button
            size="sm"
            variant="secondary"
            icon="rocket_launch"
            onClick={() => setShowRelayMenu(!showRelayMenu)}
          >
            Deploy Relay
            <span className="material-symbols-outlined ml-1 text-[18px]">
              {showRelayMenu ? "expand_less" : "expand_more"}
            </span>
          </Button>

          {showRelayMenu && (
            <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-xl border border-black/10 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-zinc-900 sm:left-auto sm:right-0">
              <button
                onClick={() => {
                  openCloudflareModal();
                  setShowRelayMenu(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-main transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-[20px] text-orange-500">
                  cloud
                </span>
                Cloudflare Relay
              </button>
              <button
                onClick={() => {
                  openVercelModal();
                  setShowRelayMenu(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-main transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-[20px] text-blue-500">
                  cloud_upload
                </span>
                Vercel Relay
              </button>
              <button
                onClick={() => {
                  openDenoModal();
                  setShowRelayMenu(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-main transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-[20px] text-green-500">
                  terminal
                </span>
                Deno Relay
              </button>
            </div>
          )}
        </div>

        <Button
          size="sm"
          variant="secondary"
          icon="upload"
          onClick={openBatchImportModal}
        >
          Batch Import
        </Button>
        <Button size="sm" icon="add" onClick={openCreateModal}>
          Add Proxy Pool
        </Button>
      </div>
    </div>
  );
}