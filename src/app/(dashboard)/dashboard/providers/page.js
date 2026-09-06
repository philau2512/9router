"use client";

import { useState } from "react";
import { CardSkeleton, Button } from "@/shared/components";
import ModelAvailabilityBadge from "./components/ModelAvailabilityBadge";
import { STATUS_FILTER_OPTIONS, matchesStatusFilter } from "./utils";
import { useProvidersState } from "./hooks/local/use-providers-state";
import ProviderCard from "./components/local/provider-card";
import ApiKeyProviderCard from "./components/local/api-key-provider-card";
import AddOpenAICompatibleModal from "./components/local/add-openai-compatible-modal";
import AddAnthropicCompatibleModal from "./components/local/add-anthropic-compatible-modal";
import ProviderTestResultsView from "./components/local/provider-test-results-view";

export default function ProvidersPage() {
  const state = useProvidersState();
  const [statusFilter, setStatusFilter] = useState("all");
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
    hiddenApikeyCount,
  } = state;
  const matches = (id, authType, noAuth = false) =>
    matchesStatusFilter(statusFilter, getProviderStats(id, authType), noAuth);
  const visibleCompatible = [
    ...compatibleProviders,
    ...anthropicCompatibleProviders,
  ].filter((info) => matches(info.id, "apikey"));
  const visibleOAuth = oauthEntries.filter(([id, info]) =>
    matches(id, "oauth", info.noAuth),
  );
  const visibleFree = freeEntries.filter(([id, info]) =>
    matches(
      id,
      id === "kiro" ? ["oauth", "apikey", "api_key"] : "oauth",
      info.noAuth,
    ),
  );
  const visibleFreeTier = freeTierEntries.filter(([id, info]) =>
    matches(id, "apikey", info.noAuth),
  );
  const visibleApiKey = apikeyEntries.filter(([id, info]) =>
    matches(id, "apikey", info.noAuth),
  );
  const apiKeyCards =
    statusFilter !== "all" || showAllApikey
      ? visibleApiKey
      : visibleApiKey.slice(0, 20);
  const hasAnyResult =
    visibleCompatible.length ||
    visibleOAuth.length ||
    visibleFree.length ||
    visibleFreeTier.length ||
    visibleApiKey.length;

  if (loading)
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );

  const renderProvider = ([id, info], authType, CardComponent) => (
    <CardComponent
      key={id}
      providerId={id}
      provider={info}
      stats={getProviderStats(id, authType)}
      authType={authType}
      onToggle={(active) => handleToggleProvider(id, authType, active)}
    />
  );

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex items-center justify-end">
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="h-8 rounded-lg border border-black/10 bg-black/[0.02] px-2 text-xs text-text-primary"
          aria-label="Filter providers by connection status"
        >
          {STATUS_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {!hasAnyResult && (
        <div className="text-center py-8 border border-dashed border-border rounded-xl">
          <span className="material-symbols-outlined text-[32px] text-text-muted mb-2">
            search_off
          </span>
          <p className="text-text-muted text-sm">
            No providers match your search or filters
          </p>
        </div>
      )}
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-semibold">Custom Providers</h2>
          <div className="grid grid-cols-1 gap-2 sm:flex">
            <Button
              size="sm"
              icon="add"
              onClick={() => setShowAddAnthropicCompatibleModal(true)}
            >
              Add Anthropic Compatible
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="add"
              onClick={() => setShowAddCompatibleModal(true)}
            >
              Add OpenAI Compatible
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleCompatible.map((info) => (
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
          ))}
        </div>
      </section>
      {visibleOAuth.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg sm:text-xl font-semibold">
              OAuth Providers
            </h2>
            <div className="flex items-center gap-2">
              <ModelAvailabilityBadge />
              <button
                onClick={() => handleBatchTest("oauth")}
                disabled={!!testingMode}
                className="rounded-lg border px-3 py-2 text-xs"
              >
                {testingMode === "oauth" ? "Testing..." : "Test All"}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleOAuth.map((entry) =>
              renderProvider(entry, "oauth", ProviderCard),
            )}
          </div>
        </section>
      )}
      {(visibleFree.length > 0 || visibleFreeTier.length > 0) && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg sm:text-xl font-semibold">
            Free Tier Providers
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleFree.map((entry) =>
              renderProvider(
                entry,
                entry[0] === "kiro" ? ["oauth", "apikey", "api_key"] : "oauth",
                ProviderCard,
              ),
            )}
            {visibleFreeTier.map((entry) =>
              renderProvider(entry, "apikey", ApiKeyProviderCard),
            )}
          </div>
        </section>
      )}
      {visibleApiKey.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg sm:text-xl font-semibold">
              API Key Providers
            </h2>
            <button
              onClick={() => handleBatchTest("apikey")}
              disabled={!!testingMode}
              className="rounded-lg border px-3 py-2 text-xs"
            >
              {testingMode === "apikey" ? "Testing..." : "Test All"}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {apiKeyCards.map((entry) =>
              renderProvider(entry, "apikey", ApiKeyProviderCard),
            )}
          </div>
          {statusFilter === "all" &&
            !showAllApikey &&
            hiddenApikeyCount > 0 && (
              <button
                onClick={() => setShowAllApikey(true)}
                className="rounded-lg border border-dashed px-3 py-2 text-sm text-primary"
              >
                Show all {visibleApiKey.length} providers
              </button>
            )}
        </section>
      )}
      <AddOpenAICompatibleModal
        isOpen={showAddCompatibleModal}
        onClose={() => setShowAddCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((nodes) => [...nodes, node]);
          setShowAddCompatibleModal(false);
        }}
      />
      <AddAnthropicCompatibleModal
        isOpen={showAddAnthropicCompatibleModal}
        onClose={() => setShowAddAnthropicCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((nodes) => [...nodes, node]);
          setShowAddAnthropicCompatibleModal(false);
        }}
      />
      {testResults && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[10vh]"
          onClick={() => setTestResults(null)}
        >
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative w-full max-w-[600px] rounded-xl border border-border bg-surface p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <ProviderTestResultsView results={testResults} />
          </div>
        </div>
      )}
    </div>
  );
}
