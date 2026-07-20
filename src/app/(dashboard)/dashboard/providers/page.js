"use client";

import { CardSkeleton, Button } from "@/shared/components";
import ModelAvailabilityBadge from "./components/ModelAvailabilityBadge";

// Import custom hook
import { useProvidersState } from "./hooks/local/use-providers-state";

// Import local components
import ProviderCard from "./components/local/provider-card";
import ApiKeyProviderCard from "./components/local/api-key-provider-card";
import AddOpenAICompatibleModal from "./components/local/add-openai-compatible-modal";
import AddAnthropicCompatibleModal from "./components/local/add-anthropic-compatible-modal";
import ProviderTestResultsView from "./components/local/provider-test-results-view";

export default function ProvidersPage() {
  const {
    setProviderNodes,
    loading,
    showAllApikey,
    setShowAllApikey,
    showAddCompatibleModal,
    setShowAddCompatibleModal,
    showAddAnthropicCompatibleModal,
    setShowAddAnthropicCompatibleModal,
    testingMode,
    testResults,
    setTestResults,
    getProviderStats,
    handleToggleProvider,
    handleBatchTest,
    compatibleProviders,
    anthropicCompatibleProviders,
    oauthEntries,
    freeEntries,
    freeTierEntries,
    apikeyEntries,
    visibleApikeyEntries,
    hiddenApikeyCount,
    hasAnyResult,
    isApikeySearching,
  } = useProvidersState();

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {!hasAnyResult && (
        <div className="text-center py-8 border border-dashed border-border rounded-xl">
          <span className="material-symbols-outlined text-[32px] text-text-muted mb-2">
            search_off
          </span>
          <p className="text-text-muted text-sm">
            No providers match your search
          </p>
        </div>
      )}

      {/* Custom Providers (OpenAI/Anthropic Compatible) — dynamic */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            Custom Providers (OpenAI/Anthropic Compatible){" "}
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:flex sm:w-auto">
            <Button
              size="sm"
              icon="add"
              onClick={() => setShowAddAnthropicCompatibleModal(true)}
              className="w-full sm:w-auto"
            >
              Add Anthropic Compatible
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="add"
              onClick={() => setShowAddCompatibleModal(true)}
              className="w-full !bg-white !text-black hover:!bg-gray-100 sm:w-auto"
            >
              Add OpenAI Compatible
            </Button>
          </div>
        </div>
        {compatibleProviders.length === 0 &&
        anthropicCompatibleProviders.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-2 border border-dashed border-border rounded-xl text-text-muted text-sm">
            <span className="material-symbols-outlined text-[18px]">
              extension
            </span>
            <span>
              No custom providers — use buttons above to add OpenAI/Anthropic
              compatible endpoints
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {[...compatibleProviders, ...anthropicCompatibleProviders].map(
              (info) => (
                <ApiKeyProviderCard
                  key={info.id}
                  providerId={info.id}
                  provider={info}
                  stats={getProviderStats(info.id, "apikey")}
                  authType="compatible"
                  onToggle={(active) =>
                    handleToggleProvider(info.id, "apikey", active)
                  }
                />
              ),
            )}
          </div>
        )}
      </div>

      {/* OAuth Providers */}
      {oauthEntries.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
              OAuth Providers
            </h2>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <ModelAvailabilityBadge />
              <button
                onClick={() => handleBatchTest("oauth")}
                disabled={!!testingMode}
                className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors sm:w-auto sm:py-1.5 ${
                  testingMode === "oauth"
                    ? "bg-primary/20 border-primary/40 text-primary animate-pulse"
                    : "bg-bg border-border text-text-muted hover:text-text-main hover:border-primary/40"
                }`}
                title="Test all OAuth connections"
                aria-label="Test all OAuth connections"
              >
                <span
                  className={`material-symbols-outlined text-[14px]${testingMode === "oauth" ? " animate-spin" : ""}`}
                >
                  play_arrow
                </span>
                {testingMode === "oauth" ? "Testing..." : "Test All"}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {oauthEntries.map(([key, info]) => (
              <ProviderCard
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, "oauth")}
                authType="oauth"
                onToggle={(active) =>
                  handleToggleProvider(key, "oauth", active)
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Free Tier Providers */}
      {(freeEntries.length > 0 || freeTierEntries.length > 0) && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
              Free Tier Providers
            </h2>
            <button
              onClick={() => handleBatchTest("free")}
              disabled={!!testingMode}
              className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors sm:w-auto sm:py-1.5 ${
                testingMode === "free"
                  ? "bg-primary/20 border-primary/40 text-primary animate-pulse"
                  : "bg-bg border-border text-text-muted hover:text-text-main hover:border-primary/40"
              }`}
              title="Test all Free connections"
              aria-label="Test all Free provider connections"
            >
              <span
                className={`material-symbols-outlined text-[14px]${testingMode === "free" ? " animate-spin" : ""}`}
              >
                play_arrow
              </span>
              {testingMode === "free" ? "Testing..." : "Test All"}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {freeEntries.map(([key, info]) => {
              // Kiro accepts OAuth + headless api-key; count/toggle both so the
              // card total matches the provider detail page. Headless flow uses
              // authType "api_key"; generic providers use "apikey".
              const freeAuthTypes =
                key === "kiro" ? ["oauth", "apikey", "api_key"] : "oauth";
              return (
                <ProviderCard
                  key={key}
                  providerId={key}
                  provider={info}
                  stats={getProviderStats(key, freeAuthTypes)}
                  authType="free"
                  onToggle={(active) =>
                    handleToggleProvider(key, freeAuthTypes, active)
                  }
                />
              );
            })}
            {freeTierEntries.map(([key, info]) => (
              <ApiKeyProviderCard
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, "apikey")}
                authType="apikey"
                onToggle={(active) =>
                  handleToggleProvider(key, "apikey", active)
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* API Key Providers — fixed list */}
      {apikeyEntries.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
              API Key Providers{" "}
            </h2>
            <button
              onClick={() => handleBatchTest("apikey")}
              disabled={!!testingMode}
              className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors sm:w-auto sm:py-1.5 ${
                testingMode === "apikey"
                  ? "bg-primary/20 border-primary/40 text-primary animate-pulse"
                  : "bg-bg border-border text-text-muted hover:text-text-main hover:border-primary/40"
              }`}
              title="Test all API Key connections"
              aria-label="Test all API Key connections"
            >
              <span
                className={`material-symbols-outlined text-[14px]${testingMode === "apikey" ? " animate-spin" : ""}`}
              >
                play_arrow
              </span>
              {testingMode === "apikey" ? "Testing..." : "Test All"}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {visibleApikeyEntries.map(([key, info]) => (
              <ApiKeyProviderCard
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, "apikey")}
                authType="apikey"
                onToggle={(active) =>
                  handleToggleProvider(key, "apikey", active)
                }
              />
            ))}
          </div>
          {!isApikeySearching && !showAllApikey && hiddenApikeyCount > 0 && (
            <button
              onClick={() => setShowAllApikey(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/40 px-3 py-2.5 text-sm font-medium text-primary transition-colors hover:border-primary hover:bg-primary/5"
            >
              <span className="material-symbols-outlined text-[16px]">
                expand_more
              </span>
              Show all {apikeyEntries.length} providers
            </button>
          )}
        </div>
      )}

      {/* Add Custom Providers Modals */}
      <AddOpenAICompatibleModal
        isOpen={showAddCompatibleModal}
        onClose={() => setShowAddCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddCompatibleModal(false);
        }}
      />
      <AddAnthropicCompatibleModal
        isOpen={showAddAnthropicCompatibleModal}
        onClose={() => setShowAddAnthropicCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddAnthropicCompatibleModal(false);
        }}
      />

      {/* Test Results Modal */}
      {testResults && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[6vh] sm:pt-[10vh]"
          onClick={() => setTestResults(null)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative bg-surface border border-border rounded-xl w-full max-w-[600px] max-h-[86vh] sm:max-h-[80vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b border-border bg-surface/95 backdrop-blur-sm rounded-t-xl">
              <h3 className="font-semibold">Test Results</h3>
              <button
                onClick={() => setTestResults(null)}
                className="p-1 rounded-lg hover:bg-bg text-text-muted hover:text-text-main transition-colors"
                aria-label="Close test results"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>
            <div className="p-5">
              <ProviderTestResultsView results={testResults} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
