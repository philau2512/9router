"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Modal, ModelSelectModal } from "@/shared/components";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { CardSkeleton } from "@/shared/components/Loading";
import { ApiKeyLimitFormFields } from "../endpoint/components/ApiKeyLimitFormFields";
import { StatusAlert } from "../endpoint/components/StatusAlert";
import {
  buildUsageDetailMessage,
  buildUsageSummaryItems,
  formatLimitState,
  formatUsageHistoryValue,
  formatUsageMetricValue,
  getLimitBadgeClass,
  getUsageHistoryStatusClass,
  getUsageMetricLabel,
  getUsagePeriodLabel,
} from "../endpoint/utils/endpointLimitHelpers";
import { useKeyBudgets } from "./hooks/useKeyBudgets";

function getProgressPercent(key) {
  const state = key.limitState;
  if (!state?.enabled || !state.limitValue) return 0;
  return Math.min(
    100,
    Math.max(0, (state.currentValue / state.limitValue) * 100),
  );
}

function maskKey(value) {
  if (!value) return "";
  return value.length > 8 ? `${value.slice(0, 8)}...` : value;
}

function SummaryCard({ icon, label, value, tone = "text-text-main" }) {
  return (
    <div className="rounded-[14px] border border-border-subtle bg-surface p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-text-muted">{label}</p>
          <p className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</p>
        </div>
        <span className="material-symbols-outlined text-[28px] text-primary">
          {icon}
        </span>
      </div>
    </div>
  );
}

function toDisplayText(value, fallback = "") {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (!value || typeof value !== "object") return fallback;

  for (const field of ["name", "label", "value", "id"]) {
    const text = toDisplayText(value[field]);
    if (text) return text;
  }

  return fallback;
}

function getProviderLabel(provider) {
  return toDisplayText(provider?.name, toDisplayText(provider?.id, "Unknown provider"));
}

function getAccessSummary(keyItem) {
  const providerCount = keyItem.allowedProviders?.length || 0;
  const modelCount = keyItem.allowedModels?.length || 0;
  if (!providerCount && !modelCount) return "All access";
  return [
    providerCount && `${providerCount} provider${providerCount === 1 ? "" : "s"}`,
    modelCount && `${modelCount} model${modelCount === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function AccessStatus({ keyItem }) {
  const unrestricted =
    !(keyItem.allowedProviders?.length || keyItem.allowedModels?.length);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${unrestricted ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" : "bg-purple-500/10 text-purple-600 dark:text-purple-400"}`}
    >
      {getAccessSummary(keyItem)}
    </span>
  );
}

function BudgetStatus({ keyItem }) {
  const display = formatLimitState(keyItem);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${getLimitBadgeClass(display.status)}`}
    >
      {display.status === "unlimited" ? "Unlimited" : display.status}
    </span>
  );
}

function BudgetProgress({ keyItem }) {
  const display = formatLimitState(keyItem);
  const percent = getProgressPercent(keyItem);

  if (!keyItem.limitState?.enabled) {
    return <p className="text-sm text-text-muted">No budget configured.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-text-main">{display.summary}</span>
        <span className="text-text-muted">{Math.round(percent)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        {display.remaining && <span>{display.remaining}</span>}
        {display.reset && <span>{display.reset}</span>}
      </div>
    </div>
  );
}

function UsageDetails({ details, loading, keyItem }) {
  if (loading) {
    return <p className="text-sm text-text-muted">Loading recent usage...</p>;
  }

  if (!details) {
    return (
      <p className="text-sm text-text-muted">Usage details are not loaded.</p>
    );
  }

  const history = details.history || [];
  const summaryItems = buildUsageSummaryItems(
    details.limitState || keyItem.limitState,
  );

  return (
    <div className="mt-4 rounded-lg border border-border-subtle bg-surface-2/40 p-4">
      <div className="mb-3 flex flex-col gap-1">
        <p className="text-sm font-medium text-text-main">Recent usage</p>
        <p className="text-xs text-text-muted">
          {buildUsageDetailMessage(keyItem)}
        </p>
      </div>

      {summaryItems.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {summaryItems.map((item) => (
            <div key={item.label} className="rounded-lg bg-surface p-3">
              <p className="text-xs text-text-muted">{item.label}</p>
              <p className="text-sm font-semibold text-text-main">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {history.length === 0 ? (
        <p className="text-sm text-text-muted">
          No recent usage recorded for this key.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
                <th className="py-2 font-medium">Time</th>
                <th className="py-2 font-medium">Model</th>
                <th className="py-2 font-medium">Endpoint</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 text-right font-medium">Usage</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry, index) => (
                <tr
                  key={`${entry.timestamp}-${index}`}
                  className="border-b border-border-subtle/60 last:border-0"
                >
                  <td className="py-2 text-text-muted">
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td className="py-2 text-text-main">{entry.model || "-"}</td>
                  <td className="py-2 text-text-muted">
                    {entry.endpoint || "-"}
                  </td>
                  <td
                    className={`py-2 ${getUsageHistoryStatusClass(Number(entry.status) || 200)}`}
                  >
                    {entry.status || "200"}
                  </td>
                  <td className="py-2 text-right text-text-main">
                    {formatUsageHistoryValue(entry)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KeyBudgetCard({
  keyItem,
  usageDetails,
  expanded,
  loadingUsage,
  visible,
  copied,
  onEdit,
  onEditAccess,
  onToggleUsage,
  onToggleVisibility,
  onCopy,
}) {
  const state = keyItem.limitState;
  const metric = state?.enabled
    ? getUsageMetricLabel(state.metricType)
    : "No metric";
  const period = state?.enabled
    ? getUsagePeriodLabel(state.periodType)
    : "No period";

  return (
    <div className="rounded-[14px] border border-border-subtle bg-surface p-5 shadow-[var(--shadow-soft)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-semibold text-text-main">
              {keyItem.name || "Unnamed key"}
            </h3>
            <BudgetStatus keyItem={keyItem} />
            <AccessStatus keyItem={keyItem} />
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${keyItem.isActive ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-surface-2 text-text-muted"}`}
            >
              {keyItem.isActive ? "Active" : "Paused"}
            </span>
          </div>
          <div className="group/key flex items-center gap-2">
            <code className="font-mono text-xs text-text-muted break-all">
              {visible ? keyItem.key : maskKey(keyItem.key) || keyItem.id}
            </code>
            <button
              onClick={() => onToggleVisibility(keyItem.id)}
              className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary opacity-100 sm:opacity-0 sm:group-hover/key:opacity-100 transition-all"
              title={visible ? "Hide key" : "Show key"}
              aria-label={visible ? "Hide API key" : "Show API key"}
            >
              <span className="material-symbols-outlined text-[14px]">
                {visible ? "visibility_off" : "visibility"}
              </span>
            </button>
            <button
              onClick={() => onCopy(keyItem.key, keyItem.id)}
              className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary opacity-100 sm:opacity-0 sm:group-hover/key:opacity-100 transition-all"
              title="Copy key"
              aria-label="Copy API key"
            >
              <span className="material-symbols-outlined text-[14px]">
                {copied ? "check" : "content_copy"}
              </span>
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-text-muted">Metric</p>
              <p className="text-sm font-medium text-text-main">{metric}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted">Window</p>
              <p className="text-sm font-medium text-text-main">{period}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted">Current</p>
              <p className="text-sm font-medium text-text-main">
                {state?.enabled
                  ? formatUsageMetricValue(state.currentValue)
                  : "Unlimited"}
              </p>
            </div>
          </div>
          <BudgetProgress keyItem={keyItem} />
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button
            variant="secondary"
            icon="edit"
            onClick={() => onEdit(keyItem)}
          >
            Edit Budget
          </Button>
          <Button
            variant="secondary"
            icon="policy"
            onClick={() => onEditAccess(keyItem)}
          >
            Edit Access
          </Button>
          <Button
            variant="ghost"
            icon={expanded ? "expand_less" : "receipt_long"}
            onClick={() => onToggleUsage(keyItem)}
          >
            {expanded ? "Hide Usage" : "Recent Usage"}
          </Button>
        </div>
      </div>

      {expanded && (
        <UsageDetails
          details={usageDetails}
          loading={loadingUsage}
          keyItem={keyItem}
        />
      )}
    </div>
  );
}

export default function KeyBudgetsPageClient() {
  const {
    keys,
    loading,
    status,
    summary,
    editingKey,
    editingAccessKey,
    editKeyLimit,
    editAccess,
    formError,
    savingKeyId,
    expandedKeyId,
    usageDetailsByKeyId,
    loadingUsageKeyId,
    visibleKeys,
    copiedKeyId,
    setEditKeyLimit,
    setEditAccess,
    loadKeys,
    openEditModal,
    closeEditModal,
    openAccessModal,
    closeAccessModal,
    toggleKeyVisibility,
    copyKey,
    saveBudget,
    saveAccess,
    toggleUsageDetails,
  } = useKeyBudgets();
  const [activeProviders, setActiveProviders] = useState([]);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const providerOptions = useMemo(
    () =>
      Object.values(AI_PROVIDERS)
        .map((provider) => ({ ...provider, label: getProviderLabel(provider) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/providers")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) {
          setActiveProviders(
            (data?.connections || []).filter((connection) => connection.isActive !== false),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setActiveProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleAllowedProvider = (providerId) => {
    setEditAccess((current) => ({
      ...current,
      allowedProviders: current.allowedProviders.includes(providerId)
        ? current.allowedProviders.filter((id) => id !== providerId)
        : [...current.allowedProviders, providerId],
    }));
  };

  const addAllowedModel = (model) => {
    const modelValue = toDisplayText(model?.value, toDisplayText(model));
    if (!modelValue) return;

    setEditAccess((current) =>
      current.allowedModels.includes(modelValue)
        ? current
        : { ...current, allowedModels: [...current.allowedModels, modelValue] },
    );
  };

  const removeAllowedModel = (model) => {
    const modelValue = toDisplayText(model?.value, toDisplayText(model));
    if (!modelValue) return;

    setEditAccess((current) => ({
      ...current,
      allowedModels: current.allowedModels.filter((item) => item !== modelValue),
    }));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" icon="refresh" onClick={loadKeys}>
          Refresh
        </Button>
        <Link href="/dashboard/usage">
          <Button variant="ghost" icon="bar_chart">
            Full Usage Analytics
          </Button>
        </Link>
      </div>

      {status && <StatusAlert status={status} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon="vpn_key" label="Total keys" value={summary.total} />
        <SummaryCard
          icon="price_check"
          label="Budgeted"
          value={summary.budgeted}
        />
        <SummaryCard
          icon="all_inclusive"
          label="Unlimited"
          value={summary.unlimited}
        />
        <SummaryCard
          icon="warning"
          label="Needs attention"
          value={summary.attention}
          tone={
            summary.attention > 0
              ? "text-yellow-600 dark:text-yellow-400"
              : "text-text-main"
          }
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : keys.length === 0 ? (
        <div className="rounded-[14px] border border-border-subtle bg-surface p-8 text-center shadow-[var(--shadow-soft)]">
          <span className="material-symbols-outlined text-[36px] text-text-muted">
            vpn_key_off
          </span>
          <h2 className="mt-3 text-lg font-semibold text-text-main">
            No API keys yet
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Create API keys on the Endpoint page, then manage budgets here.
          </p>
          <Link href="/dashboard/endpoint" className="mt-4 inline-flex">
            <Button icon="api">Go to Endpoint</Button>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {keys.map((keyItem) => (
            <KeyBudgetCard
              key={keyItem.id}
              keyItem={keyItem}
              usageDetails={usageDetailsByKeyId[keyItem.id]}
              expanded={expandedKeyId === keyItem.id}
              loadingUsage={loadingUsageKeyId === keyItem.id}
              visible={visibleKeys.has(keyItem.id)}
              copied={copiedKeyId === keyItem.id}
              onEdit={openEditModal}
              onEditAccess={openAccessModal}
              onToggleUsage={toggleUsageDetails}
              onToggleVisibility={toggleKeyVisibility}
              onCopy={copyKey}
            />
          ))}
        </div>
      )}

      <Modal
        isOpen={!!editingKey}
        title="Edit Key Budget"
        onClose={closeEditModal}
      >
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium text-text-main">
              {editingKey?.name}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <code className="font-mono text-xs text-text-muted break-all">
                {visibleKeys.has(editingKey?.id)
                  ? editingKey?.key
                  : maskKey(editingKey?.key)}
              </code>
              <button
                onClick={() => toggleKeyVisibility(editingKey?.id)}
                className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all"
                title={
                  visibleKeys.has(editingKey?.id) ? "Hide key" : "Show key"
                }
                aria-label={
                  visibleKeys.has(editingKey?.id)
                    ? "Hide API key"
                    : "Show API key"
                }
              >
                <span className="material-symbols-outlined text-[14px]">
                  {visibleKeys.has(editingKey?.id)
                    ? "visibility_off"
                    : "visibility"}
                </span>
              </button>
              <button
                onClick={() => copyKey(editingKey?.key, editingKey?.id)}
                className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-all"
                title="Copy key"
                aria-label="Copy API key"
              >
                <span className="material-symbols-outlined text-[14px]">
                  {copiedKeyId === editingKey?.id ? "check" : "content_copy"}
                </span>
              </button>
            </div>
          </div>
          <ApiKeyLimitFormFields
            form={editKeyLimit}
            onChange={setEditKeyLimit}
            description="Limit state is based on recorded usage. Use Usage for deeper analytics."
          />
          {formError && (
            <StatusAlert status={{ type: "error", message: formError }} />
          )}
          <div className="flex gap-2">
            <Button
              onClick={saveBudget}
              fullWidth
              disabled={!editingKey || savingKeyId === editingKey?.id}
            >
              {savingKeyId === editingKey?.id ? "Saving..." : "Save Budget"}
            </Button>
            <Button onClick={closeEditModal} variant="ghost" fullWidth>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!editingAccessKey}
        title="Edit Key Access"
        onClose={closeAccessModal}
      >
        <div className="flex flex-col gap-5">
          <div>
            <p className="text-sm font-medium text-text-main">
              {editingAccessKey?.name}
            </p>
            <p className="mt-1 text-sm text-text-muted">
              Match if provider or model is allowed. Leave both empty for all access.
            </p>
          </div>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-text-main">Providers</label>
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() =>
                  setEditAccess((current) => ({ ...current, allowedProviders: [] }))
                }
              >
                Clear
              </button>
            </div>
            <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto rounded-lg border border-border-subtle p-3 sm:grid-cols-2">
              {providerOptions.map((provider) => (
                <label
                  key={provider.id}
                  className="flex cursor-pointer items-center gap-2 text-sm text-text-main"
                >
                  <input
                    type="checkbox"
                    checked={editAccess.allowedProviders.includes(provider.id)}
                    onChange={() => toggleAllowedProvider(provider.id)}
                  />
                  {provider.label}
                </label>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-text-main">Models</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() =>
                    setEditAccess((current) => ({ ...current, allowedModels: [] }))
                  }
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setShowModelSelect(true)}
                >
                  Select models
                </button>
              </div>
            </div>
            {editAccess.allowedModels.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-subtle p-3 text-sm text-text-muted">
                No model restriction configured.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 rounded-lg border border-border-subtle p-3">
                {editAccess.allowedModels.map((model) => {
                  const modelValue = toDisplayText(model);
                  return (
                    <button
                      key={modelValue}
                      type="button"
                      onClick={() => removeAllowedModel(modelValue)}
                      className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-xs text-text-main hover:text-red-500"
                      title="Remove model"
                    >
                      {modelValue} ×
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {formError && <StatusAlert status={{ type: "error", message: formError }} />}
          <div className="flex gap-2">
            <Button
              onClick={saveAccess}
              fullWidth
              disabled={!editingAccessKey || savingKeyId === editingAccessKey?.id}
            >
              {savingKeyId === editingAccessKey?.id ? "Saving..." : "Save Access"}
            </Button>
            <Button onClick={closeAccessModal} variant="ghost" fullWidth>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <ModelSelectModal
        isOpen={showModelSelect}
        onClose={() => setShowModelSelect(false)}
        onSelect={addAllowedModel}
        onDeselect={removeAllowedModel}
        activeProviders={activeProviders}
        addedModelValues={editAccess.allowedModels}
        closeOnSelect={false}
        title="Allow Models"
      />
    </div>
  );
}
