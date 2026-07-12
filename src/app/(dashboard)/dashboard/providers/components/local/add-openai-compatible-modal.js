import { useState } from "react";
import PropTypes from "prop-types";
import {
  Badge,
  Button,
  Input,
  Modal,
  Select,
} from "@/shared/components";

export default function AddOpenAICompatibleModal({ isOpen, onClose, onCreated }) {
  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    apiType: "chat",
    baseUrl: "https://api.openai.com/v1",
  });
  const [submitting, setSubmitting] = useState(false);
  const [checkKey, setCheckKey] = useState("");
  const [checkModelId, setCheckModelId] = useState("");
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);

  const apiTypeOptions = [
    { value: "chat", label: "Chat Completions" },
    { value: "responses", label: "Responses API" },
  ];

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
          apiType: formData.apiType,
          baseUrl: formData.baseUrl,
          type: "openai-compatible",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        onCreated(data.node);
        setFormData({
          name: "",
          prefix: "",
          apiType: "chat",
          baseUrl: "https://api.openai.com/v1",
        });
        setCheckKey("");
        setValidationResult(null);
      }
    } catch (error) {
      console.log("Error creating OpenAI Compatible node:", error);
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
          type: "openai-compatible",
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
    <Modal isOpen={isOpen} title="Add OpenAI Compatible" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="OpenAI Compatible (Prod)"
          hint="Required. A friendly label for this node."
        />
        <Input
          label="Prefix"
          value={formData.prefix}
          onChange={(e) => setFormData({ ...formData, prefix: e.target.value })}
          placeholder="oc-prod"
          hint="Required. Used as the provider prefix for model IDs."
        />
        <Select
          label="API Type"
          options={apiTypeOptions}
          value={formData.apiType}
          onChange={(e) =>
            setFormData({ ...formData, apiType: e.target.value })
          }
        />
        <Input
          label="Base URL"
          value={formData.baseUrl}
          onChange={(e) =>
            setFormData({ ...formData, baseUrl: e.target.value })
          }
          placeholder="https://api.openai.com/v1"
          hint="Use the base URL (ending in /v1) for your OpenAI-compatible API."
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
          placeholder="e.g. gpt-4, claude-3-opus"
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
    </Modal>
  );
}

AddOpenAICompatibleModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
};