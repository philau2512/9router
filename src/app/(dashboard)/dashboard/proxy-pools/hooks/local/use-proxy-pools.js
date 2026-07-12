import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNotificationStore } from "@/store/notificationStore";
import { normalizeFormData, parseProxyLine } from "../../components/local/helpers";

export function useProxyPools() {
  const [proxyPools, setProxyPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showBatchImportModal, setShowBatchImportModal] = useState(false);
  const [showVercelModal, setShowVercelModal] = useState(false);
  const [showCloudflareModal, setShowCloudflareModal] = useState(false);
  const [showDenoModal, setShowDenoModal] = useState(false);
  const [showRelayMenu, setShowRelayMenu] = useState(false);
  const [editingProxyPool, setEditingProxyPool] = useState(null);
  const [formData, setFormData] = useState(normalizeFormData());
  const [batchImportText, setBatchImportText] = useState("");
  const [vercelForm, setVercelForm] = useState({
    vercelToken: "",
    projectName: "vercel-relay",
  });
  const [cloudflareForm, setCloudflareForm] = useState({
    accountId: "",
    apiToken: "",
    projectName: "cloudflare-relay",
  });
  const [denoForm, setDenoForm] = useState({
    denoToken: "",
    orgDomain: "",
    projectName: "",
  });
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthProgress, setHealthProgress] = useState({
    current: 0,
    total: 0,
  });
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const relayMenuRef = useRef(null);
  const notify = useNotificationStore();

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (relayMenuRef.current && !relayMenuRef.current.contains(e.target)) {
        setShowRelayMenu(false);
      }
    };
    if (showRelayMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showRelayMenu]);

  const pruneSelectedIds = (nextPools) => {
    setSelectedIds((prev) =>
      prev.filter((id) => nextPools.some((p) => p.id === id)),
    );
  };

  const updateProxyPools = (updater) => {
    setProxyPools((prev) => {
      const nextPools = typeof updater === "function" ? updater(prev) : updater;
      pruneSelectedIds(nextPools);
      return nextPools;
    });
  };

  const fetchProxyPools = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy-pools?includeUsage=true", {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) {
        updateProxyPools(data.proxyPools || []);
      }
    } catch (error) {
      console.log("Error fetching proxy pools:", error);
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchProxyPools();
    }, 0);

    return () => clearTimeout(timer);
  }, [fetchProxyPools]);

  const resetForm = () => {
    setEditingProxyPool(null);
    setFormData(normalizeFormData());
  };

  const openCreateModal = () => {
    resetForm();
    setShowFormModal(true);
  };

  const openEditModal = (proxyPool) => {
    setEditingProxyPool(proxyPool);
    setFormData(normalizeFormData(proxyPool));
    setShowFormModal(true);
  };

  const closeFormModal = () => {
    setShowFormModal(false);
    resetForm();
  };

  const handleSave = async () => {
    const payload = {
      name: formData.name.trim(),
      proxyUrl: formData.proxyUrl.trim(),
      noProxy: formData.noProxy.trim(),
      isActive: formData.isActive === true,
      strictProxy: formData.strictProxy === true,
    };

    if (!payload.name || !payload.proxyUrl) return;

    setSaving(true);
    try {
      const isEdit = !!editingProxyPool;
      const res = await fetch(
        isEdit ? `/api/proxy-pools/${editingProxyPool.id}` : "/api/proxy-pools",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (res.ok) {
        await fetchProxyPools();
        closeFormModal();
        notify.success(
          editingProxyPool ? "Proxy pool updated" : "Proxy pool created",
        );
      } else {
        const data = await res.json();
        notify.error(data.error || "Failed to save proxy pool");
      }
    } catch (error) {
      console.log("Error saving proxy pool:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (proxyPool) => {
    setConfirmState({
      title: "Delete Proxy Pool",
      message: `Delete proxy pool "${proxyPool.name}"?`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/proxy-pools/${proxyPool.id}`, {
            method: "DELETE",
          });
          if (res.ok) {
            updateProxyPools((prev) =>
              prev.filter((item) => item.id !== proxyPool.id),
            );
            notify.success("Proxy pool deleted");
            return;
          }

          const data = await res.json();
          if (res.status === 409) {
            notify.warning(
              `Cannot delete: ${data.boundConnectionCount || 0} connection(s) are still using this pool.`,
            );
          } else {
            notify.error(data.error || "Failed to delete proxy pool");
          }
        } catch (error) {
          console.log("Error deleting proxy pool:", error);
          notify.error("Failed to delete proxy pool");
        }
      },
    });
  };

  const handleTest = async (proxyPoolId) => {
    setTestingId(proxyPoolId);
    try {
      const res = await fetch(`/api/proxy-pools/${proxyPoolId}/test`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        notify.error(data.error || "Failed to test proxy");
        return;
      }

      await fetchProxyPools();
      notify.success(data.ok ? "Proxy test passed" : "Proxy test failed");
    } catch (error) {
      console.log("Error testing proxy pool:", error);
      notify.error("Failed to test proxy");
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleActive = async (pool) => {
    const next = !pool.isActive;
    updateProxyPools((prev) =>
      prev.map((p) => (p.id === pool.id ? { ...p, isActive: next } : p)),
    );
    try {
      const res = await fetch(`/api/proxy-pools/${pool.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) {
        updateProxyPools((prev) =>
          prev.map((p) =>
            p.id === pool.id ? { ...p, isActive: pool.isActive } : p,
          ),
        );
        notify.error("Failed to update active state");
      }
    } catch (error) {
      console.log("Error toggling active:", error);
      setProxyPools((prev) =>
        prev.map((p) =>
          p.id === pool.id ? { ...p, isActive: pool.isActive } : p,
        ),
      );
    }
  };

  const allSelected =
    proxyPools.length > 0 && selectedIds.length === proxyPools.length;
  const toggleSelect = (id) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  const toggleSelectAll = () =>
    setSelectedIds(allSelected ? [] : proxyPools.map((p) => p.id));
  const clearSelection = () => setSelectedIds([]);

  const bulkSetActive = async (isActive) => {
    const targets =
      selectedIds.length > 0 ? selectedIds : proxyPools.map((p) => p.id);
    if (targets.length === 0) return;
    setBulkBusy(true);
    try {
      let ok = 0;
      let failed = 0;
      for (const id of targets) {
        try {
          const res = await fetch(`/api/proxy-pools/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive }),
          });
          if (res.ok) ok += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
      await fetchProxyPools();
      notify.success(
        `${isActive ? "Activated" : "Deactivated"} ${ok}${failed ? `, failed ${failed}` : ""}`,
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setConfirmState({
      title: "Delete Proxy Pools",
      message: `Delete ${selectedIds.length} proxy pool(s)?`,
      onConfirm: async () => {
        setConfirmState(null);
        setBulkBusy(true);
        try {
          let ok = 0;
          let blocked = 0;
          let failed = 0;
          for (const id of selectedIds) {
            try {
              const res = await fetch(`/api/proxy-pools/${id}`, {
                method: "DELETE",
              });
              if (res.ok) ok += 1;
              else if (res.status === 409) blocked += 1;
              else failed += 1;
            } catch {
              failed += 1;
            }
          }
          await fetchProxyPools();
          clearSelection();
          notify.success(
            `Deleted ${ok}${blocked ? `, ${blocked} bound` : ""}${failed ? `, ${failed} failed` : ""}`,
          );
        } finally {
          setBulkBusy(false);
        }
      },
    });
  };

  const handleHealthCheck = async () => {
    const targets =
      selectedIds.length > 0
        ? proxyPools.filter((p) => selectedIds.includes(p.id))
        : proxyPools;
    if (targets.length === 0) return;
    setHealthChecking(true);
    setHealthProgress({ current: 0, total: targets.length });
    let alive = 0;
    const deadIds = [];
    let done = 0;
    const CONCURRENCY = 10;
    const queue = [...targets];

    const worker = async () => {
      while (queue.length > 0) {
        const pool = queue.shift();
        if (!pool) break;
        try {
          const res = await fetch(`/api/proxy-pools/${pool.id}/test`, {
            method: "POST",
          });
          const data = await res.json();
          if (res.ok && data.ok) alive += 1;
          else deadIds.push(pool.id);
        } catch {
          deadIds.push(pool.id);
        } finally {
          done += 1;
          setHealthProgress({ current: done, total: targets.length });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker),
    );
    await fetchProxyPools();
    setHealthChecking(false);
    setHealthProgress({ current: 0, total: 0 });

    if (deadIds.length > 0) {
      setConfirmState({
        title: "Disable Dead Proxies",
        message: `Alive: ${alive}, Dead: ${deadIds.length}.\n\nDisable ${deadIds.length} dead proxies?`,
        onConfirm: async () => {
          setConfirmState(null);
          setBulkBusy(true);
          try {
            for (const id of deadIds) {
              try {
                await fetch(`/api/proxy-pools/${id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ isActive: false }),
                });
              } catch {}
            }
            await fetchProxyPools();
            notify.success(`Disabled ${deadIds.length} dead proxies`);
          } finally {
            setBulkBusy(false);
          }
        },
      });
    } else {
      notify.success(
        `Health check done. Alive: ${alive}, Dead: ${deadIds.length}`,
      );
    }
  };

  const openBatchImportModal = () => {
    setBatchImportText("");
    setShowBatchImportModal(true);
  };

  const closeBatchImportModal = () => {
    if (importing) return;
    setShowBatchImportModal(false);
  };

  const openVercelModal = () => {
    setVercelForm({ vercelToken: "", projectName: "vercel-relay" });
    setShowVercelModal(true);
  };

  const closeVercelModal = () => {
    if (deploying) return;
    setShowVercelModal(false);
  };

  const openCloudflareModal = () => {
    setCloudflareForm({
      accountId: "",
      apiToken: "",
      projectName: "cloudflare-relay",
    });
    setShowCloudflareModal(true);
  };

  const closeCloudflareModal = () => {
    if (deploying) return;
    setShowCloudflareModal(false);
  };

  const openDenoModal = () => {
    setDenoForm({ denoToken: "", orgDomain: "", projectName: "" });
    setShowDenoModal(true);
  };

  const closeDenoModal = () => {
    if (deploying) return;
    setShowDenoModal(false);
  };

  const handleVercelDeploy = async () => {
    if (!vercelForm.vercelToken.trim()) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/proxy-pools/vercel-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vercelForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        closeVercelModal();
        notify.success(`Deployed: ${data.deployUrl}`);
      } else {
        notify.error(data.error || "Deploy failed");
      }
    } catch (error) {
      console.log("Error deploying Vercel relay:", error);
      notify.error("Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  const handleCloudflareDeploy = async () => {
    if (!cloudflareForm.accountId.trim() || !cloudflareForm.apiToken.trim())
      return;
    setDeploying(true);
    try {
      const res = await fetch("/api/proxy-pools/cloudflare-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cloudflareForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        closeCloudflareModal();
        notify.success(`Deployed: ${data.deployUrl}`);
      } else {
        notify.error(data.error || "Deploy failed");
      }
    } catch (error) {
      console.log("Error deploying Cloudflare relay:", error);
      notify.error("Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  const handleDenoDeploy = async () => {
    if (!denoForm.denoToken.trim()) return;
    setDeploying(true);
    try {
      const res = await fetch("/api/proxy-pools/deno-deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(denoForm),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchProxyPools();
        closeDenoModal();
        notify.success(`Deployed: ${data.deployUrl}`);
      } else {
        notify.error(data.error || "Deploy failed");
      }
    } catch (error) {
      console.log("Error deploying Deno relay:", error);
      notify.error("Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  const handleBatchImport = async () => {
    const lines = batchImportText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      notify.warning("Please paste at least one proxy line.");
      return;
    }

    const parsedEntries = [];
    const invalidLines = [];

    lines.forEach((line, index) => {
      try {
        const parsed = parseProxyLine(line);
        if (parsed) {
          parsedEntries.push({
            ...parsed,
            lineNumber: index + 1,
          });
        }
      } catch (error) {
        invalidLines.push(`Line ${index + 1}: ${error.message}`);
      }
    });

    if (invalidLines.length > 0) {
      notify.error(`Invalid proxy format:\n${invalidLines.join("\n")}`);
      return;
    }

    setImporting(true);
    try {
      const existingKeys = new Set(
        proxyPools.map(
          (pool) =>
            `${(pool.proxyUrl || "").trim()}|||${(pool.noProxy || "").trim()}`,
        ),
      );

      let created = 0;
      let skipped = 0;
      let failed = 0;

      for (const entry of parsedEntries) {
        const dedupeKey = `${entry.proxyUrl}|||`;
        if (existingKeys.has(dedupeKey)) {
          skipped += 1;
          continue;
        }

        const res = await fetch("/api/proxy-pools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: entry.name,
            proxyUrl: entry.proxyUrl,
            noProxy: "",
            isActive: true,
          }),
        });

        if (res.ok) {
          created += 1;
          existingKeys.add(dedupeKey);
        } else {
          failed += 1;
        }
      }

      await fetchProxyPools();
      setShowBatchImportModal(false);
      notify.success(
        `Batch import completed: Created ${created}, Skipped ${skipped}, Failed ${failed}`,
      );
    } catch (error) {
      console.log("Error batch importing proxies:", error);
      notify.error("Batch import failed");
    } finally {
      setImporting(false);
    }
  };

  const activeCount = useMemo(
    () => proxyPools.filter((pool) => pool.isActive === true).length,
    [proxyPools],
  );

  return {
    proxyPools,
    loading,
    showFormModal,
    showBatchImportModal,
    showVercelModal,
    showCloudflareModal,
    showDenoModal,
    showRelayMenu,
    editingProxyPool,
    formData,
    batchImportText,
    vercelForm,
    cloudflareForm,
    denoForm,
    saving,
    importing,
    deploying,
    testingId,
    selectedIds,
    healthChecking,
    healthProgress,
    bulkBusy,
    confirmState,
    relayMenuRef,
    activeCount,
    allSelected,
    fetchProxyPools,
    openCreateModal,
    openEditModal,
    closeFormModal,
    handleSave,
    handleDelete,
    handleTest,
    handleToggleActive,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    bulkSetActive,
    bulkDelete,
    handleHealthCheck,
    openBatchImportModal,
    closeBatchImportModal,
    openVercelModal,
    closeVercelModal,
    openCloudflareModal,
    closeCloudflareModal,
    openDenoModal,
    closeDenoModal,
    handleVercelDeploy,
    handleCloudflareDeploy,
    handleDenoDeploy,
    handleBatchImport,
    setShowRelayMenu,
    setFormData,
    setBatchImportText,
    setVercelForm,
    setCloudflareForm,
    setDenoForm,
    setConfirmState,
  };
}