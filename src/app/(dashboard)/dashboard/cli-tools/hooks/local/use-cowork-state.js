import { useState, useEffect, useCallback } from "react";
import { ENDPOINT, stripV1, ensureV1 } from "../../components/local/helpers";

export function useCoworkState({
  apiKeys,
  initialStatus,
  isExpanded,
  cloudEnabled,
}) {
  const [status, setStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState(
    () => apiKeys?.[0]?.key || "",
  );
  const [selectedModels, setSelectedModels] = useState(
    () => initialStatus?.cowork?.models || [],
  );
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState(() =>
    initialStatus?.cowork?.baseUrl ? stripV1(initialStatus.cowork.baseUrl) : "",
  );
  const [plugins, setPlugins] = useState(() =>
    Array.isArray(initialStatus?.cowork?.plugins) &&
    initialStatus.cowork.plugins.length > 0
      ? initialStatus.cowork.plugins
      : Array.isArray(initialStatus?.defaultPlugins)
        ? initialStatus.defaultPlugins
        : [],
  );
  const [localPlugins, setLocalPlugins] = useState(
    () => initialStatus?.cowork?.localPlugins || [],
  );
  const [customPlugins, setCustomPlugins] = useState(
    () => initialStatus?.cowork?.customPlugins || [],
  );
  const [modelAliases, setModelAliases] = useState({});
  const [comboModalOpen, setComboModalOpen] = useState(false);
  const [modelSelectOpen, setModelSelectOpen] = useState(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [addMcpOpen, setAddMcpOpen] = useState(false);
  const [addMcpForm, setAddMcpForm] = useState({
    type: "url",
    name: "",
    url: "",
    command: "",
    args: "",
  });

  const [prevApiKeys, setPrevApiKeys] = useState(apiKeys);
  if (apiKeys !== prevApiKeys) {
    setPrevApiKeys(apiKeys);
    if (!selectedApiKey && apiKeys?.length > 0) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }

  const [prevInitialStatus, setPrevInitialStatus] = useState(initialStatus);
  if (initialStatus !== prevInitialStatus) {
    setPrevInitialStatus(initialStatus);
    if (initialStatus) {
      setStatus(initialStatus);
      if (initialStatus.cowork?.models?.length) {
        setSelectedModels(initialStatus.cowork.models);
      }
      if (initialStatus.cowork?.baseUrl) {
        setCustomBaseUrl(stripV1(initialStatus.cowork.baseUrl));
      }
      if (
        Array.isArray(initialStatus.cowork?.plugins) &&
        initialStatus.cowork.plugins.length > 0
      ) {
        setPlugins(initialStatus.cowork.plugins);
      } else if (Array.isArray(initialStatus.defaultPlugins)) {
        setPlugins(initialStatus.defaultPlugins);
      }
      if (Array.isArray(initialStatus.cowork?.localPlugins)) {
        setLocalPlugins(initialStatus.cowork.localPlugins);
      }
      if (
        Array.isArray(initialStatus.cowork?.customPlugins) &&
        initialStatus.cowork.customPlugins.length > 0
      ) {
        setCustomPlugins(initialStatus.cowork.customPlugins);
      }
    }
  }

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch(ENDPOINT);
      const data = await res.json();
      setStatus(data);
      if (data?.cowork?.models?.length) {
        setSelectedModels(data.cowork.models);
      }
      if (data?.cowork?.baseUrl) {
        setCustomBaseUrl(stripV1(data.cowork.baseUrl));
      }
      if (
        Array.isArray(data?.cowork?.plugins) &&
        data.cowork.plugins.length > 0
      ) {
        setPlugins(data.cowork.plugins);
      } else if (Array.isArray(data?.defaultPlugins)) {
        setPlugins(data.defaultPlugins);
      }
      if (Array.isArray(data?.cowork?.localPlugins)) {
        setLocalPlugins(data.cowork.localPlugins);
      }
      if (
        Array.isArray(data?.cowork?.customPlugins) &&
        data.cowork.customPlugins.length > 0
      ) {
        setCustomPlugins(data.cowork.customPlugins);
      }
    } catch (error) {
      setStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (isExpanded && !status) {
      const timer = setTimeout(() => {
        checkStatus();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isExpanded, status, checkStatus]);

  useEffect(() => {
    if (!isExpanded) return;
    fetch("/api/models/alias")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setModelAliases(data.aliases || {});
      })
      .catch(() => {});
  }, [isExpanded]);

  const getEffectiveBaseUrl = useCallback(() => ensureV1(customBaseUrl), [customBaseUrl]);

  const getConfigStatus = useCallback(() => {
    if (!status?.installed) return null;
    const url = status?.cowork?.baseUrl;
    if (!url) return "not_configured";
    return status.has9Router ? "configured" : "other";
  }, [status]);

  const handleApply = useCallback(async () => {
    setMessage(null);
    const effectiveUrl = getEffectiveBaseUrl();

    if (selectedModels.length === 0) {
      setMessage({ type: "error", text: "Please select at least one model" });
      return;
    }

    setApplying(true);
    try {
      const keyToUse =
        selectedApiKey?.trim() ||
        (apiKeys?.length > 0 ? apiKeys[0].key : null) ||
        (!cloudEnabled ? "sk_9router" : null);

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: effectiveUrl,
          apiKey: keyToUse,
          models: selectedModels,
          plugins,
          localPlugins,
          customPlugins,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({
          type: "success",
          text: "Settings applied. Quit & reopen Claude Desktop to load.",
        });
        checkStatus();
      } else {
        setMessage({
          type: "error",
          text: data.error || "Failed to apply settings",
        });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  }, [selectedModels, selectedApiKey, apiKeys, cloudEnabled, getEffectiveBaseUrl, plugins, localPlugins, customPlugins, checkStatus]);

  const handleCreateCombo = useCallback(async ({ name, models }) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, models }),
      });
      if (!res.ok) {
        const err = await res.json();
        setMessage({
          type: "error",
          text: err.error || "Failed to create combo",
        });
        return;
      }
      if (!selectedModels.includes(name)) {
        setSelectedModels([...selectedModels, name]);
      }
      setComboModalOpen(false);
      setMessage({
        type: "success",
        text: `Combo "${name}" created and added.`,
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  }, [selectedModels]);

  const handleAddModel = useCallback((model) => {
    const value = model?.value || model?.name || model;
    if (!value) return;
    setSelectedModels((prev) => (prev.includes(value) ? prev : [...prev, value]));
  }, []);

  const handleRemoveModel = useCallback((model) => {
    const value = model?.value || model?.name || model;
    setSelectedModels((prev) => prev.filter((item) => item !== value));
  }, []);

  const handleReset = useCallback(async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch(ENDPOINT, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully" });
        setSelectedModels([]);
        setPlugins(status?.defaultPlugins || []);
        setLocalPlugins([]);
        setCustomPlugins([]);
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  }, [status, checkStatus]);

  const addPlugin = useCallback((p) => {
    setPlugins((prev) => (prev.some((x) => x.name === p.name) ? prev : [...prev, p]));
  }, []);

  const removePlugin = useCallback((name) => {
    setPlugins((prev) => prev.filter((p) => p.name !== name));
  }, []);

  const getManualConfigs = useCallback(() => {
    const keyToUse =
      selectedApiKey && selectedApiKey.trim()
        ? selectedApiKey
        : !cloudEnabled
          ? "sk_9router"
          : "<API_KEY_FROM_DASHBOARD>";

    const modelsToShow =
      selectedModels.length > 0 ? selectedModels : ["provider/model-id"];
    const cfg = {
      inferenceProvider: "gateway",
      inferenceGatewayBaseUrl:
        getEffectiveBaseUrl() || "https://your-public-host/v1",
      inferenceGatewayApiKey: keyToUse,
      inferenceModels: modelsToShow.map((name) => ({ name })),
    };

    return [
      {
        filename:
          "~/Library/Application Support/Claude-3p/configLibrary/<appliedId>.json",
        content: JSON.stringify(cfg, null, 2),
      },
    ];
  }, [selectedApiKey, cloudEnabled, selectedModels, getEffectiveBaseUrl]);

  return {
    status,
    setStatus,
    checking,
    setChecking,
    applying,
    restoring,
    message,
    setMessage,
    selectedApiKey,
    setSelectedApiKey,
    selectedModels,
    setSelectedModels,
    showManualConfigModal,
    setShowManualConfigModal,
    customBaseUrl,
    setCustomBaseUrl,
    plugins,
    setPlugins,
    localPlugins,
    setLocalPlugins,
    customPlugins,
    setCustomPlugins,
    modelAliases,
    comboModalOpen,
    setComboModalOpen,
    modelSelectOpen,
    setModelSelectOpen,
    marketplaceOpen,
    setMarketplaceOpen,
    addMcpOpen,
    setAddMcpOpen,
    addMcpForm,
    setAddMcpForm,
    checkStatus,
    getEffectiveBaseUrl,
    getConfigStatus,
    handleApply,
    handleCreateCombo,
    handleAddModel,
    handleRemoveModel,
    handleReset,
    addPlugin,
    removePlugin,
    getManualConfigs,
  };
}