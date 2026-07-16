import { useState } from "react";
import PropTypes from "prop-types";
import {
  Badge,
  Button,
  Input,
  Modal,
} from "@/shared/components";

function AddAnthropicCompatibleModalContent({ onClose, onCreated }) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    baseUrl: "https://api.anthropic.com/v1",
    connectionTimeoutMs: "",
    stallTimeoutMs: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null); // { valid, error, method }

  const handleSubmit = async () => {
    if (
      !formData.name.trim() ||
      !formData.prefix.trim() ||
      !formData.baseUrl.trim()
    )
      return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/provider-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          prefix: formData.prefix,
          baseUrl: formData.baseUrl,
          type: "anthropic-compatible",
          // Always send both keys: empty → null (clear to default), number → set.
          connectionTimeoutMs:
            formData.connectionTimeoutMs === ""
              ? null
              : Number(formData.connectionTimeoutMs),
          stallTimeoutMs:
            formData.stallTimeoutMs === ""
              ? null
              : Number(formData.stallTimeoutMs),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        onCreated(data.node);
        setFormData({
          name: "",
          prefix: "",
          baseUrl: "https://api.anthropic.com/v1",
          connectionTimeoutMs: "",
          stallTimeoutMs: "",
        });
        setCheckKey("");
        setValidationResult(null);
      }
    } catch (error) {
      console.log("Error creating Anthropic Compatible node:", error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/provider-nodes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: formData.baseUrl,
          apiKey: checkKey,
          type: "anthropic-compatible",
          modelId: checkModelId.trim() || undefined,
        }),
      });
      const data = await res.json();
      setValidationResult(data);
    } catch {
      setValidationResult({ valid: false, error: "Network error" });
    } finally {
      setValidating(false);
    }
  };

  // Helper to render validation result
  const renderValidationResult = () => {
    if (!validationResult) return null;
    const { valid, error, method } = validationResult;

    if (valid) {
      return (
        <>
          <Badge variant="success">Valid</Badge>
          {method === "chat" && (
            <span className="text-sm text-text-muted">
              (via inference test)
            </span>
          )}
        </>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <Badge variant="error">Invalid</Badge>
        {error && <span className="text-sm text-red-500">{error}</span>}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Input
        label="Name"
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        placeholder="Anthropic Compatible (Prod)"
        hint="Required. A friendly label for this node."
      />
      <Input
        label="Prefix"
        value={formData.prefix}
        onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
        placeholder="ac-prod"
        hint="Required. Used as the provider prefix for model IDs."
      />
      <Input
        label="Base URL"
        value={formData.baseUrl}
        onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
        placeholder="https://api.anthropic.com/v1"
        hint="Use the base URL (ending in /v1) for your Anthropic-compatible API. The system will append /messages."
      />
      <Input
        label="Connection timeout (ms)"
        type="number"
        value={formData.connectionTimeoutMs}
        onChange={(e) =>
          setFormData({ ...formData, connectionTimeoutMs: e.target.value })
        }
        placeholder="Default 60000 (max 120000)"
        hint="Optional. Raw milliseconds until upstream headers must arrive. Raise for slow reasoning models. Leave empty for default."
      />
      <Input
        label="Stall timeout (ms)"
        type="number"
        value={formData.stallTimeoutMs}
        onChange={(e) =>
          setFormData({ ...formData, stallTimeoutMs: e.target.value })
        }
        placeholder="Default 300000 (max 600000)"
        hint="Optional. Raw milliseconds of stream silence before abort. Raise for slow reasoning models. Leave empty for default."
      />
      <Input
        label="API Key (for Check)"
        type="password"
        value={checkKey}
        onChange={(e) => setCheckKey(e.target.value)}
      />
      <Input
        label="Model ID (optional)"
        value={checkModelId}
        onChange={(e) => setCheckModelId(e.target.value)}
        placeholder="e.g. claude-3-opus"
        hint="If provider lacks /models endpoint, enter a model ID to validate via chat/completions instead."
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          onClick={handleValidate}
          disabled={!checkKey || validating || !formData.baseUrl.trim()}
          variant="secondary"
          className="w-full sm:w-auto"
        >
          {validating ? "Checking..." : "Check"}
        </Button>
        {renderValidationResult()}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          onClick={handleSubmit}
          fullWidth
          disabled={
            !formData.name.trim() ||
            !formData.prefix.trim() ||
            !formData.baseUrl.trim() ||
            submitting
          }
        >
          {submitting ? "Creating..." : "Create"}
        </Button>
        <Button onClick={onClose} variant="ghost" fullWidth>
          Cancel
        </Button>
      </div>
    </div>
  );
}

AddAnthropicCompatibleModalContent.propTypes = {
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
};

export default function AddAnthropicCompatibleModal({ isOpen, onClose, onCreated }) {
  return (
    <Modal isOpen={isOpen} title="Add Anthropic Compatible" onClose={onClose}>
      <AddAnthropicCompatibleModalContent
        key={isOpen ? "open" : "closed"}
        onClose={onClose}
        onCreated={onCreated}
      />
    </Modal>
  );
}

AddAnthropicCompatibleModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
};