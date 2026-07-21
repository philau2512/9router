"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchKeys,
  fetchKeyUsage,
  updateKey,
} from "../../endpoint/services/endpointApiService";
import {
  buildLimitFormFromKey,
  buildLimitPayload,
  buildUpdatedKey,
  createDefaultLimitForm,
  normalizeLimitForm,
} from "../../endpoint/utils/endpointLimitHelpers";

function normalizeAllowlistValue(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return "";

  for (const field of ["value", "id", "name", "label"]) {
    const normalized = normalizeAllowlistValue(value[field]);
    if (normalized) return normalized;
  }

  return "";
}

function normalizeAllowlist(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).filter((value) => {
    const normalized = normalizeAllowlistValue(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).map(normalizeAllowlistValue);
}

export function useKeyBudgets() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [editingAccessKey, setEditingAccessKey] = useState(null);
  const [editKeyLimit, setEditKeyLimit] = useState(createDefaultLimitForm());
  const [editAccess, setEditAccess] = useState({
    allowedProviders: [],
    allowedModels: [],
  });
  const [formError, setFormError] = useState("");
  const [savingKeyId, setSavingKeyId] = useState(null);
  const [expandedKeyId, setExpandedKeyId] = useState(null);
  const [usageDetailsByKeyId, setUsageDetailsByKeyId] = useState({});
  const [loadingUsageKeyId, setLoadingUsageKeyId] = useState(null);
  const [visibleKeys, setVisibleKeys] = useState(new Set());
  const [copiedKeyId, setCopiedKeyId] = useState(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setStatus(null);
    try {
      const { ok, data } = await fetchKeys();
      if (ok) {
        setKeys(data.keys || []);
      } else {
        setStatus({
          type: "error",
          message: data.error || "Failed to load API keys",
        });
      }
    } catch {
      setStatus({ type: "error", message: "Failed to load API keys" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(loadKeys, 0);
    return () => window.clearTimeout(timer);
  }, [loadKeys]);

  const summary = useMemo(() => {
    const budgeted = keys.filter((key) => key.limitState?.enabled).length;
    const attention = keys.filter((key) =>
      ["near", "exceeded"].includes(key.limitState?.status),
    ).length;
    return {
      total: keys.length,
      budgeted,
      unlimited: keys.length - budgeted,
      attention,
    };
  }, [keys]);

  const openEditModal = useCallback((key) => {
    setEditingKey(key);
    setEditKeyLimit(buildLimitFormFromKey(key));
    setFormError("");
  }, []);

  const closeEditModal = useCallback(() => {
    setEditingKey(null);
    setEditKeyLimit(createDefaultLimitForm());
    setFormError("");
  }, []);

  const openAccessModal = useCallback((key) => {
    setEditingAccessKey(key);
    setEditAccess({
      allowedProviders: normalizeAllowlist(key.allowedProviders),
      allowedModels: normalizeAllowlist(key.allowedModels),
    });
    setFormError("");
  }, []);

  const closeAccessModal = useCallback(() => {
    setEditingAccessKey(null);
    setEditAccess({ allowedProviders: [], allowedModels: [] });
    setFormError("");
  }, []);

  const toggleKeyVisibility = useCallback((keyId) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(keyId)) next.delete(keyId);
      else next.add(keyId);
      return next;
    });
  }, []);

  const copyKey = useCallback(async (keyValue, keyId) => {
    if (!keyValue) return;
    await navigator.clipboard.writeText(keyValue);
    setCopiedKeyId(keyId);
    window.setTimeout(() => setCopiedKeyId(null), 2000);
  }, []);

  const saveBudget = useCallback(async () => {
    if (!editingKey) return;
    const validationError = normalizeLimitForm(editKeyLimit);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSavingKeyId(editingKey.id);
    setFormError("");
    try {
      const payload = buildLimitPayload(editKeyLimit);
      const { ok, data } = await updateKey(editingKey.id, payload);

      if (ok) {
        setKeys((prev) =>
          prev.map((key) =>
            key.id === editingKey.id ? buildUpdatedKey(key, {}, data.key) : key,
          ),
        );
        setUsageDetailsByKeyId((prev) => {
          const current = prev[editingKey.id];
          if (!current) return prev;
          return {
            ...prev,
            [editingKey.id]: {
              ...current,
              key: data.key || current.key,
              limitState: data.key?.limitState || current.limitState,
            },
          };
        });
        setStatus({ type: "success", message: "Budget updated" });
        closeEditModal();
      } else {
        setFormError(data.error || "Failed to update budget");
      }
    } catch {
      setFormError("Failed to update budget");
    } finally {
      setSavingKeyId(null);
    }
  }, [closeEditModal, editKeyLimit, editingKey]);

  const saveAccess = useCallback(async () => {
    if (!editingAccessKey) return;

    setSavingKeyId(editingAccessKey.id);
    setFormError("");
    try {
      const payload = {
        allowedProviders: normalizeAllowlist(editAccess.allowedProviders),
        allowedModels: normalizeAllowlist(editAccess.allowedModels),
      };
      const { ok, data } = await updateKey(editingAccessKey.id, payload);
      if (ok) {
        setKeys((prev) =>
          prev.map((key) =>
            key.id === editingAccessKey.id
              ? buildUpdatedKey(key, {}, data.key)
              : key,
          ),
        );
        setStatus({ type: "success", message: "Access updated" });
        closeAccessModal();
      } else {
        setFormError(data.error || "Failed to update access");
      }
    } catch {
      setFormError("Failed to update access");
    } finally {
      setSavingKeyId(null);
    }
  }, [closeAccessModal, editAccess, editingAccessKey]);

  const toggleUsageDetails = useCallback(
    async (key) => {
      if (expandedKeyId === key.id) {
        setExpandedKeyId(null);
        return;
      }

      setExpandedKeyId(key.id);
      if (usageDetailsByKeyId[key.id]) return;

      setLoadingUsageKeyId(key.id);
      try {
        const { ok, data } = await fetchKeyUsage(key.id, 5);
        if (ok) {
          setUsageDetailsByKeyId((prev) => ({ ...prev, [key.id]: data }));
          if (data.limitState) {
            setKeys((prev) =>
              prev.map((item) =>
                item.id === key.id
                  ? buildUpdatedKey(
                      item,
                      { limitState: data.limitState },
                      data.key,
                    )
                  : item,
              ),
            );
          }
        } else {
          setStatus({
            type: "error",
            message: data.error || "Failed to load usage details",
          });
        }
      } catch {
        setStatus({ type: "error", message: "Failed to load usage details" });
      } finally {
        setLoadingUsageKeyId(null);
      }
    },
    [expandedKeyId, usageDetailsByKeyId],
  );

  return {
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
  };
}
