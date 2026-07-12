import { Button, Input, Modal, Toggle } from "@/shared/components";

export default function ProxyPoolFormModal({
  isOpen,
  onClose,
  editingProxyPool,
  formData,
  setFormData,
  handleSave,
  saving,
}) {
  return (
    <Modal
      isOpen={isOpen}
      title={editingProxyPool ? "Edit Proxy Pool" : "Add Proxy Pool"}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, name: e.target.value }))
          }
          placeholder="Office Proxy"
        />
        <Input
          label="Proxy URL"
          value={formData.proxyUrl}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, proxyUrl: e.target.value }))
          }
          placeholder="http://127.0.0.1:7897"
        />
        <Input
          label="No Proxy"
          value={formData.noProxy}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, noProxy: e.target.value }))
          }
          placeholder="localhost,127.0.0.1,.internal"
          hint="Comma-separated hosts/domains to bypass proxy"
        />

        <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-sm">Active</p>
            <p className="text-xs text-text-muted">
              Inactive pools are ignored by runtime resolution.
            </p>
          </div>
          <Toggle
            checked={formData.isActive === true}
            onChange={() =>
              setFormData((prev) => ({ ...prev, isActive: !prev.isActive }))
            }
            disabled={saving}
          />
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-sm">Strict Proxy</p>
            <p className="text-xs text-text-muted">
              Fail request if proxy is unreachable instead of falling back to
              direct.
            </p>
          </div>
          <Toggle
            checked={formData.strictProxy === true}
            onChange={() =>
              setFormData((prev) => ({
                ...prev,
                strictProxy: !prev.strictProxy,
              }))
            }
            disabled={saving}
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            fullWidth
            onClick={handleSave}
            disabled={
              !formData.name.trim() || !formData.proxyUrl.trim() || saving
            }
          >
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button
            fullWidth
            variant="ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}