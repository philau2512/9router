/**
 * Pure topology graph layout (no React / xyflow).
 * Used by ProviderTopology and unit tests for edge-glow regressions.
 */
import { AI_PROVIDERS } from "@/shared/constants/providers";
import {
  countActiveProviderGroups,
  isTopologyProviderActive,
} from "./topologyActiveMatch";

function getProviderConfig(providerId) {
  return AI_PROVIDERS[providerId] || { color: "#6b7280", name: providerId };
}

function getProviderImageUrl(providerId) {
  return `/providers/${providerId}.png`;
}

/**
 * Place N nodes evenly along an ellipse around the router center.
 * Active / last / error flags use sibling-aware match (xai ↔ grok-cli).
 */
export function buildLayout(providers, activeSet, lastSet, errorSet) {
  const nodeW = 180;
  const nodeH = 30;
  const routerW = 120;
  const routerH = 44;
  const nodeGap = 24;

  const count = providers.length;

  const minRx = ((nodeW + nodeGap) * count) / (2 * Math.PI);
  const rx = Math.max(320, minRx);
  const ry = Math.max(200, rx * 0.55);
  if (count === 0) {
    return {
      nodes: [
        {
          id: "router",
          type: "router",
          position: { x: 0, y: 0 },
          data: { activeCount: 0 },
          draggable: false,
        },
      ],
      edges: [],
    };
  }

  const nodes = [];
  const edges = [];

  nodes.push({
    id: "router",
    type: "router",
    position: { x: -routerW / 2, y: -routerH / 2 },
    // Sibling expand must not inflate the badge (xai+grok-cli still count as 1)
    data: { activeCount: countActiveProviderGroups(activeSet) },
    draggable: false,
  });

  const edgeStyle = (active, last, error, _color) => {
    if (error) return { stroke: "#ef4444", strokeWidth: 2.5, opacity: 0.9 };
    if (active) return { stroke: "#22c55e", strokeWidth: 2.5, opacity: 0.9 };
    if (last) return { stroke: "#f59e0b", strokeWidth: 2, opacity: 0.7 };
    return { stroke: "#4b5563", strokeWidth: 1.5, opacity: 0.5 };
  };

  providers.forEach((p, i) => {
    const config = getProviderConfig(p.provider);
    // Match via sibling expand: pending `xai` lights graph node `grok-cli`
    const active = isTopologyProviderActive(p.provider, activeSet);
    const last = !active && isTopologyProviderActive(p.provider, lastSet);
    const error = !active && isTopologyProviderActive(p.provider, errorSet);
    const nodeId = `provider-${p.provider}`;
    const data = {
      label:
        (config.name !== p.provider ? config.name : null) ||
        p.nodeName ||
        p.name ||
        p.provider,
      color: config.color || "#6b7280",
      imageUrl: getProviderImageUrl(p.provider),
      textIcon:
        config.textIcon || (p.provider || "?").slice(0, 2).toUpperCase(),
      active,
    };

    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    const cx = rx * Math.cos(angle);
    const cy = ry * Math.sin(angle);

    let sourceHandle, targetHandle;
    if (
      Math.abs(angle + Math.PI / 2) < Math.PI / 4 ||
      Math.abs(angle - (3 * Math.PI) / 2) < Math.PI / 4
    ) {
      sourceHandle = "top";
      targetHandle = "bottom";
    } else if (Math.abs(angle - Math.PI / 2) < Math.PI / 4) {
      sourceHandle = "bottom";
      targetHandle = "top";
    } else if (cx > 0) {
      sourceHandle = "right";
      targetHandle = "left";
    } else {
      sourceHandle = "left";
      targetHandle = "right";
    }

    nodes.push({
      id: nodeId,
      type: "provider",
      position: { x: cx - nodeW / 2, y: cy - nodeH / 2 },
      data,
      draggable: false,
    });

    edges.push({
      id: `e-${nodeId}`,
      source: "router",
      sourceHandle,
      target: nodeId,
      targetHandle,
      animated: active,
      style: edgeStyle(active, last, error, config.color),
    });
  });

  return { nodes, edges };
}