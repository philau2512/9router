"use client";

import {
  Card,
  ComboFormModal,
  ManualConfigModal,
  McpMarketplaceModal,
  ModelSelectModal,
} from "@/shared/components";
import Image from "next/image";
import { useCoworkState } from "../hooks/local/use-cowork-state";
import { CustomMcpModal } from "./local/custom-mcp-modal";
import { CoworkToolConfigForm } from "./local/cowork-tool-config-form";

export default function CoworkToolCard({
  tool,
  isExpanded,
  onToggle,
  apiKeys,
  activeProviders,
  hasActiveProviders,
  cloudEnabled,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
  initialStatus,
}) {
  const state = useCoworkState({
    apiKeys,
    initialStatus,
    isExpanded,
    cloudEnabled,
  });
  const configStatus = state.getConfigStatus();

  return (
    <Card padding="xs" className="overflow-hidden">
      <div
        className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center"
        onClick={onToggle}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image
              src={tool.image}
              alt={tool.name}
              width={32}
              height={32}
              className="size-8 object-contain rounded-lg"
              sizes="32px"
              loading="lazy"
              decoding="async"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">
                  Connected
                </span>
              )}
              {configStatus === "not_configured" && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">
                  Not configured
                </span>
              )}
              {configStatus === "other" && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">
                  Other
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted truncate">
              {tool.description}
            </p>
          </div>
        </div>
        <span
          className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}
        >
          expand_more
        </span>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {state.checking && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">
                progress_activity
              </span>
              <span>Checking Claude Cowork...</span>
            </div>
          )}
          {!state.checking && state.status && !state.status.installed && (
            <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-yellow-500">
                  warning
                </span>
                <div className="flex-1">
                  <p className="font-medium text-yellow-600 dark:text-yellow-400">
                    Claude Desktop (Cowork mode) not detected
                  </p>
                  <p className="text-sm text-text-muted">
                    Open Claude Desktop → Help → Troubleshooting → Enable
                    Developer mode → Configure third-party inference, then
                    return here.
                  </p>
                </div>
              </div>
              <div className="pl-9">
                <button
                  onClick={() => state.setShowManualConfigModal(true)}
                  className="inline-flex items-center justify-center rounded-md font-medium transition-colors border text-xs px-2.5 py-1.5 bg-yellow-500/20 border-yellow-500/40 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-500/30"
                >
                  <span className="material-symbols-outlined text-[18px] mr-1">
                    content_copy
                  </span>
                  Manual Config
                </button>
              </div>
            </div>
          )}
          {!state.checking && state.status?.installed && (
            <CoworkToolConfigForm
              status={state.status}
              getEffectiveBaseUrl={state.getEffectiveBaseUrl}
              tunnelEnabled={tunnelEnabled}
              tunnelPublicUrl={tunnelPublicUrl}
              tailscaleEnabled={tailscaleEnabled}
              tailscaleUrl={tailscaleUrl}
              cloudEnabled={cloudEnabled}
              setCustomBaseUrl={state.setCustomBaseUrl}
              selectedApiKey={state.selectedApiKey}
              setSelectedApiKey={state.setSelectedApiKey}
              apiKeys={apiKeys}
              selectedModels={state.selectedModels}
              handleRemoveModel={state.handleRemoveModel}
              setComboModalOpen={state.setComboModalOpen}
              hasActiveProviders={hasActiveProviders}
              plugins={state.plugins}
              customPlugins={state.customPlugins}
              removePlugin={state.removePlugin}
              setMarketplaceOpen={state.setMarketplaceOpen}
              setAddMcpForm={state.setAddMcpForm}
              setAddMcpOpen={state.setAddMcpOpen}
              setPlugins={state.setPlugins}
              setLocalPlugins={state.setLocalPlugins}
              localPlugins={state.localPlugins}
              setCustomPlugins={state.setCustomPlugins}
              message={state.message}
              handleApply={state.handleApply}
              applying={state.applying}
              handleReset={state.handleReset}
              restoring={state.restoring}
              setShowManualConfigModal={state.setShowManualConfigModal}
              setModelSelectOpen={state.setModelSelectOpen}
            />
          )}
        </div>
      )}

      <ManualConfigModal
        isOpen={state.showManualConfigModal}
        onClose={() => state.setShowManualConfigModal(false)}
        title="Claude Cowork - Manual Configuration"
        configs={state.getManualConfigs()}
      />
      <ComboFormModal
        isOpen={state.comboModalOpen}
        combo={null}
        onClose={() => state.setComboModalOpen(false)}
        onSave={state.handleCreateCombo}
        activeProviders={activeProviders}
        forcePrefix="claude-"
        title="Create Cowork Combo"
      />
      <ModelSelectModal
        isOpen={state.modelSelectOpen}
        onClose={() => state.setModelSelectOpen(false)}
        onSelect={state.handleAddModel}
        onDeselect={state.handleRemoveModel}
        activeProviders={activeProviders}
        modelAliases={state.modelAliases}
        title="Select Cowork Model"
        addedModelValues={state.selectedModels}
        closeOnSelect={false}
      />
      <McpMarketplaceModal
        isOpen={state.marketplaceOpen}
        onClose={() => state.setMarketplaceOpen(false)}
        onAdd={state.addPlugin}
        addedNames={state.plugins.map((plugin) => plugin.name)}
      />
      <CustomMcpModal
        isOpen={state.addMcpOpen}
        onClose={() => state.setAddMcpOpen(false)}
        addMcpForm={state.addMcpForm}
        setAddMcpForm={state.setAddMcpForm}
        setCustomPlugins={state.setCustomPlugins}
      />
    </Card>
  );
}
