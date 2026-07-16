"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import {
  MEDIA_PROVIDER_KINDS,
  AI_PROVIDERS,
  isCustomEmbeddingProvider,
} from "@/shared/constants/providers";

/**
 * Custom hook to manage the state and actions of a media provider detail page.
 * Separates logic from UI representation for future merges.
 */
export function useMediaProviderState() {
  const { kind, id } = useParams();
  const router = useRouter();
  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
  const isCustom = isCustomEmbeddingProvider(id) && kind === "embedding";

  const [customNode, setCustomNode] = useState(null);
  const [customLoading, setCustomLoading] = useState(isCustom);
  const [showEditModal, setShowEditModal] = useState(false);

  // Fetch custom node info from API for custom embedding nodes
  useEffect(() => {
    if (!isCustom) return;
    let cancelled = false;
    fetch("/api/provider-nodes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setCustomNode((d.nodes || []).find((n) => n.id === id) || null);
        setCustomLoading(false);
      })
      .catch(() => {
        if (!cancelled) setCustomLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isCustom]);

  const handleDeleteCustom = async () => {
    if (!confirm("Delete this Custom Embedding node?")) return;
    try {
      const res = await fetch(`/api/provider-nodes/${id}`, {
        method: "DELETE",
      });
      if (res.ok) router.push(`/dashboard/media-providers/${kind}`);
    } catch (error) {
      console.log("Error deleting custom embedding node:", error);
    }
  };

  const builtInProvider = AI_PROVIDERS[id];

  // For custom embedding nodes, build a synthetic provider object
  const provider = isCustom
    ? customNode
      ? {
          id,
          name: customNode.name || "Custom Embedding",
          color: "#6366F1",
          textIcon: "CE",
        }
      : null
    : builtInProvider;

  const kinds = isCustom ? ["embedding"] : (provider?.serviceKinds ?? ["llm"]);

  return {
    kind,
    id,
    kindConfig,
    isCustom,
    customNode,
    setCustomNode,
    customLoading,
    showEditModal,
    setShowEditModal,
    handleDeleteCustom,
    provider,
    kinds,
  };
}