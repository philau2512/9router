"use client";

import { CardSkeleton, ConfirmModal } from "@/shared/components";

// Import custom hook
import { useProxyPools } from "./hooks/local/use-proxy-pools";

// Import local sub-components
import ProxyPoolsHeader from "./components/local/proxy-pools-header";
import ProxyPoolsList from "./components/local/proxy-pools-list";
import ProxyPoolFormModal from "./components/local/proxy-pool-form-modal";
import ProxyBatchImportModal from "./components/local/proxy-batch-import-modal";
import RelayDeploymentModals from "./components/local/relay-deployment-modals";

export default function ProxyPoolsPage() {
  const {
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
  } = useProxyPools();

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
      {/* Header component */}
      <ProxyPoolsHeader
        relayMenuRef={relayMenuRef}
        showRelayMenu={showRelayMenu}
        setShowRelayMenu={setShowRelayMenu}
        openCloudflareModal={openCloudflareModal}
        openVercelModal={openVercelModal}
        openDenoModal={openDenoModal}
        openBatchImportModal={openBatchImportModal}
        openCreateModal={openCreateModal}
      />

      {/* Main list component */}
      <ProxyPoolsList
        proxyPools={proxyPools}
        activeCount={activeCount}
        allSelected={allSelected}
        selectedIds={selectedIds}
        healthChecking={healthChecking}
        healthProgress={healthProgress}
        bulkBusy={bulkBusy}
        toggleSelectAll={toggleSelectAll}
        toggleSelect={toggleSelect}
        handleHealthCheck={handleHealthCheck}
        bulkSetActive={bulkSetActive}
        bulkDelete={bulkDelete}
        clearSelection={clearSelection}
        handleToggleActive={handleToggleActive}
        handleTest={handleTest}
        openEditModal={openEditModal}
        handleDelete={handleDelete}
        openCreateModal={openCreateModal}
        testingId={testingId}
      />

      {/* Batch Import Modal */}
      <ProxyBatchImportModal
        isOpen={showBatchImportModal}
        onClose={closeBatchImportModal}
        batchImportText={batchImportText}
        setBatchImportText={setBatchImportText}
        handleBatchImport={handleBatchImport}
        importing={importing}
      />

      {/* Relay Deployment Modals (Vercel, Cloudflare, Deno) */}
      <RelayDeploymentModals
        showVercelModal={showVercelModal}
        closeVercelModal={closeVercelModal}
        vercelForm={vercelForm}
        setVercelForm={setVercelForm}
        handleVercelDeploy={handleVercelDeploy}
        showCloudflareModal={showCloudflareModal}
        closeCloudflareModal={closeCloudflareModal}
        cloudflareForm={cloudflareForm}
        setCloudflareForm={setCloudflareForm}
        handleCloudflareDeploy={handleCloudflareDeploy}
        showDenoModal={showDenoModal}
        closeDenoModal={closeDenoModal}
        denoForm={denoForm}
        setDenoForm={setDenoForm}
        handleDenoDeploy={handleDenoDeploy}
        deploying={deploying}
      />

      {/* Proxy Add/Edit Form Modal */}
      <ProxyPoolFormModal
        isOpen={showFormModal}
        onClose={closeFormModal}
        editingProxyPool={editingProxyPool}
        formData={formData}
        setFormData={setFormData}
        handleSave={handleSave}
        saving={saving}
      />

      {/* Global Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </div>
  );
}