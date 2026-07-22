"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import {
  ReactFlow,
  Handle,
  Position,
  Controls,
  Background,
  BaseEdge,
  getBezierPath,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { markProviderIconMissing } from "@/shared/utils/providerIcon";
import {
  buildActiveProviderSet,
  buildProviderMatchSet,
} from "./topologyActiveMatch";
import { buildLayout } from "./topologyLayout";

// Force-stop FE animation if a provider stays active longer than this
const FE_ACTIVE_TIMEOUT_MS = 60000;
const FE_ACTIVE_TICK_MS = 1000;

// Pure helpers re-exported for unit tests (no React/xyflow needed at call site).
export {
  expandTopologyProviderIds,
  buildActiveProviderSet,
  buildProviderMatchSet,
  countActiveProviderGroups,
  isTopologyProviderActive,
  TOPOLOGY_PROVIDER_ALIASES,
} from "./topologyActiveMatch";
export { buildLayout } from "./topologyLayout";

const TOKEN_LABEL_COUNT = 2;

function formatTokenCount(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value || 0);
}

// Custom provider node - rectangle with image + name
function ProviderNode({ data }) {
  const { label, color, imageUrl, textIcon, active } = data;
  const [imgError, setImgError] = useState(false);
  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border-2 transition-all duration-300 bg-bg"
      style={{
        borderColor: active ? color : "var(--color-border)",
        boxShadow: active ? `0 0 16px ${color}40` : "none",
        minWidth: "150px",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="!bg-transparent !border-0 !w-0 !h-0"
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom"
        className="!bg-transparent !border-0 !w-0 !h-0"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="!bg-transparent !border-0 !w-0 !h-0"
      />
      <Handle
        type="target"
        position={Position.Right}
        id="right"
        className="!bg-transparent !border-0 !w-0 !h-0"
      />

      {/* Provider icon */}
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}15` }}
      >
        {imageUrl && !imgError ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={imageUrl}
            alt={label}
            className="w-6 h-6 rounded-sm object-contain"
            loading="lazy"
            decoding="async"
            onError={() => {
              const match = imageUrl?.match(/^\/providers\/([^/]+)\.png$/i);
              if (match) markProviderIconMissing(match[1]);
              setImgError(true);
            }}
          />
        ) : (
          <span className="text-sm font-bold" style={{ color }}>
            {textIcon}
          </span>
        )}
      </div>

      {/* Provider name */}
      <span
        className="text-base font-medium truncate"
        style={{ color: active ? color : "var(--color-text)" }}
      >
        {label}
      </span>

      {/* Active indicator */}
      {active && (
        <span className="relative flex h-2 w-2 shrink-0">
          <span
            className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
            style={{ backgroundColor: color }}
          />
          <span
            className="relative inline-flex rounded-full h-2 w-2"
            style={{ backgroundColor: color }}
          />
        </span>
      )}
    </div>
  );
}

ProviderNode.propTypes = {
  data: PropTypes.object.isRequired,
};

// Center 9Router node — pulse/glow on card only (no expanding rings)
function RouterNode({ data }) {
  const powering = (data.activeCount || 0) > 0;
  return (
    <div
      className={`relative z-[1] flex items-center justify-center px-5 py-3 rounded-xl border-2 min-w-[130px] ${
        powering
          ? "topology-router-core border-yellow-300 bg-gradient-to-br from-primary/30 via-yellow-400/20 to-cyan-400/25"
          : "border-primary bg-primary/5 shadow-md"
      }`}
    >
      <Handle type="source" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/favicon.svg"
        alt="9Router"
        className={`w-6 h-6 mr-2 ${powering ? "topology-router-icon" : ""}`}
        loading="lazy"
        decoding="async"
      />
      <span className={`text-sm font-bold ${powering ? "topology-router-label text-yellow-300" : "text-primary"}`}>
        9Router
      </span>
      {data.activeCount > 0 && (
        <span className="ml-2 px-1.5 py-0.5 rounded-full bg-yellow-400 text-black text-xs font-bold topology-router-badge">
          {data.activeCount}
        </span>
      )}
    </div>
  );
}

RouterNode.propTypes = {
  data: PropTypes.object.isRequired,
};

// Active: electric kame beam (multi-layer stroke + sparks). Idle/last/error: solid BaseEdge.
function TopologyEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
}) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const active = !!data?.active;
  const stroke = style.stroke || "var(--color-border)";
  const inputLabel = `IN ${formatTokenCount(data?.usage?.promptTokens)}`;
  const outputLabel = `OUT ${formatTokenCount(data?.usage?.completionTokens)}`;

  if (!active) {
    return <BaseEdge id={id} path={edgePath} style={{ ...style, stroke }} />;
  }

  return (
    <g className="topology-edge-electric">
      {/* Subtle halo — labels remain readable above the active edge. */}
      <path
        d={edgePath}
        fill="none"
        stroke="#22d3ee"
        strokeWidth={7}
        strokeOpacity={0.14}
        strokeLinecap="round"
        className="topology-edge-halo"
      />
      <path
        d={edgePath}
        fill="none"
        stroke="#4ade80"
        strokeWidth={3}
        strokeOpacity={0.5}
        strokeLinecap="round"
        className="topology-edge-plasma"
      />
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke: "#a7f3d0", strokeWidth: 1.5, opacity: 0.8 }}
        className="topology-edge-kame"
      />
      {/* Input token labels: router → provider */}
      {Array.from({ length: TOKEN_LABEL_COUNT }, (_, i) => (
        <g key={`${id}-input-${i}`}>
          <animateMotion
            dur={`${2.4 + i * 0.4}s`}
            repeatCount="indefinite"
            path={edgePath}
            rotate="auto"
            begin={`${i * 1.2}s`}
          />
          <text
            y="-10"
            fill="#67e8f9"
            fontSize="10"
            fontWeight="700"
            textAnchor="middle"
            style={{ filter: "drop-shadow(0 0 2px #0f172a)" }}
          >
            {inputLabel}
          </text>
        </g>
      ))}
      {/* Output token labels: provider → router */}
      {Array.from({ length: TOKEN_LABEL_COUNT }, (_, i) => (
        <g key={`${id}-output-${i}`}>
          <animateMotion
            dur={`${2.6 + i * 0.4}s`}
            repeatCount="indefinite"
            path={edgePath}
            rotate="auto-reverse"
            keyPoints="1;0"
            keyTimes="0;1"
            calcMode="linear"
            begin={`${i * 1.3}s`}
          />
          <text
            y="-10"
            fill="#fde047"
            fontSize="10"
            fontWeight="700"
            textAnchor="middle"
            style={{ filter: "drop-shadow(0 0 2px #0f172a)" }}
          >
            {outputLabel}
          </text>
        </g>
      ))}
    </g>
  );
}

TopologyEdge.propTypes = {
  id: PropTypes.string,
  sourceX: PropTypes.number,
  sourceY: PropTypes.number,
  targetX: PropTypes.number,
  targetY: PropTypes.number,
  sourcePosition: PropTypes.string,
  targetPosition: PropTypes.string,
  style: PropTypes.object,
  data: PropTypes.object,
};

const nodeTypes = { provider: ProviderNode, router: RouterNode };
const edgeTypes = { topology: TopologyEdge };

export default function ProviderTopology({
  providers = [],
  activeRequests = [],
  recentRequests = [],
  lastProvider = "",
  errorProvider = "",
}) {
  // Serialize to stable string keys so useMemo only re-runs when values actually change.
  // Expand sibling ids here so timeout tracking and edge match share one set.
  const activeKey = useMemo(
    () =>
      Array.from(buildActiveProviderSet(activeRequests)).sort().join(","),
    [activeRequests],
  );
  const lastKey = useMemo(
    () => Array.from(buildProviderMatchSet(lastProvider)).sort().join(","),
    [lastProvider],
  );
  const errorKey = useMemo(
    () => Array.from(buildProviderMatchSet(errorProvider)).sort().join(","),
    [errorProvider],
  );

  const rawActiveSet = useMemo(
    () => new Set(activeKey ? activeKey.split(",") : []),
    [activeKey],
  );
  const lastSet = useMemo(
    () => new Set(lastKey ? lastKey.split(",") : []),
    [lastKey],
  );
  const errorSet = useMemo(
    () => new Set(errorKey ? errorKey.split(",") : []),
    [errorKey],
  );

  // Track firstSeen per active provider; drop provider if running too long (BE stuck)
  const firstSeenRef = useRef({});
  const [activeSet, setActiveSet] = useState(new Set());

  useEffect(() => {
    const syncActiveSet = () => {
      const seen = firstSeenRef.current;
      const now = Date.now();
      for (const p of rawActiveSet) {
        if (!seen[p]) seen[p] = now;
      }
      for (const p of Object.keys(seen)) {
        if (!rawActiveSet.has(p)) delete seen[p];
      }

      const filtered = new Set();
      for (const p of rawActiveSet) {
        const ts = seen[p];
        if (!ts || now - ts < FE_ACTIVE_TIMEOUT_MS) filtered.add(p);
      }
      setActiveSet(filtered);
    };

    const timer = setTimeout(syncActiveSet, 0);
    if (rawActiveSet.size === 0) {
      return () => clearTimeout(timer);
    }

    const intervalId = setInterval(syncActiveSet, FE_ACTIVE_TICK_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(intervalId);
    };
  }, [rawActiveSet]);

  const activeSetKey = useMemo(
    () => Array.from(activeSet).sort().join(","),
    [activeSet],
  );

  const { nodes, edges } = useMemo(
    () => buildLayout(providers, activeSet, lastSet, errorSet, recentRequests),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [providers, activeSetKey, lastSet, errorSet, recentRequests],
  );

  const fitOpts = useMemo(() => ({ padding: 0.2, duration: 200 }), []);

  const onInit = useCallback(
    (instance) => {
      rfInstance.current = instance;
      setTimeout(() => instance.fitView(fitOpts), 50);
    },
    [fitOpts],
  );

  const fitViewToGraph = useCallback(() => {
    if (rfInstance.current) rfInstance.current.fitView(fitOpts);
  }, [fitOpts]);

  const rfInstance = useRef(null);
  const containerRef = useRef(null);

  // Re-fit on container resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      fitViewToGraph();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitViewToGraph]);

  // Re-fit when node count/layout changes
  useEffect(() => {
    if (rfInstance.current) {
      const id = setTimeout(() => rfInstance.current.fitView(fitOpts), 50);
      return () => clearTimeout(id);
    }
  }, [fitOpts, nodes.length]);

  const providersKey = useMemo(
    () =>
      providers
        .map((p) => p.provider)
        .sort()
        .join(","),
    [providers],
  );

  return (
    <div
      ref={containerRef}
      className="h-[320px] w-full min-w-0 rounded-lg border border-border bg-bg-subtle/30 sm:h-[480px]"
    >
      {providers.length === 0 ? (
        <div className="h-full flex items-center justify-center text-text-muted text-sm">
          No providers connected
        </div>
      ) : (
        <ReactFlow
          key={providersKey}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitViewOptions={fitOpts}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          fitView
          onInit={onInit}
        >
          <Background
            color="currentColor"
            gap={24}
            className="text-text-muted/10"
          />
          <Controls showInteractive={false} />
        </ReactFlow>
      )}
    </div>
  );
}

ProviderTopology.propTypes = {
  providers: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      provider: PropTypes.string,
      name: PropTypes.string,
    }),
  ),
  activeRequests: PropTypes.arrayOf(
    PropTypes.shape({
      provider: PropTypes.string,
      model: PropTypes.string,
      account: PropTypes.string,
    }),
  ),
  recentRequests: PropTypes.arrayOf(
    PropTypes.shape({
      provider: PropTypes.string,
      promptTokens: PropTypes.number,
      completionTokens: PropTypes.number,
    }),
  ),
  lastProvider: PropTypes.string,
  errorProvider: PropTypes.string,
};
