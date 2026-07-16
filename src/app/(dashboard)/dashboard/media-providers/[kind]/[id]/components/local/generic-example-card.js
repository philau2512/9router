"use client";

import { useState, useEffect, useRef } from "react";
import { Card } from "@/shared/components";
import {
  getProviderAlias,
  resolveProviderId,
  MEDIA_PROVIDER_KINDS,
} from "@/shared/constants/providers";
import { getModelsByProviderId } from "@/shared/constants/models";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  Row,
  toImagePreviewSrc,
  getImageEditDefaults,
  KIND_EXAMPLE_CONFIG,
  formatConnectionLabel,
} from "./helpers";

export function GenericExampleCard({ providerId, kind }) {
  const providerAlias = getProviderAlias(providerId);
  const resolvedId = resolveProviderId(providerAlias);
  const safeProviderAlias =
    resolvedId === providerId ? providerAlias : providerId;
  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
  const exConfig = KIND_EXAMPLE_CONFIG[kind];
  const safeExConfig = exConfig || {};

  // Built-in models for this kind (e.g. type="image") + custom models from DB
  const builtinKindModels = getModelsByProviderId(providerId).filter((m) => {
    if (m.kinds) return m.kinds.includes(kind);
    return (m.type || "llm") === kind;
  });
  const [customKindModels, setCustomKindModels] = useState([]);
  const kindModels = [
    ...builtinKindModels,
    ...customKindModels.filter(
      (m) => !builtinKindModels.some((b) => b.id === m.id),
    ),
  ];
  // Kinds that need a model identifier in the request (image/video/music)
  const KIND_NEEDS_MODEL = new Set(["image", "video", "music", "imageToText"]);
  const needsModel = KIND_NEEDS_MODEL.has(kind);
  const allowManualModel = needsModel && kindModels.length === 0;
  const [selectedModel, setSelectedModel] = useState(
    builtinKindModels[0]?.id ?? "",
  );
  const selectedModelObj = kindModels.find((m) => m.id === selectedModel);
  const supportsEdit = !!selectedModelObj?.capabilities?.includes("edit");
  const supportsMask = !!selectedModelObj?.capabilities?.includes("mask");
  // Catalog flag + id heuristic: 1.5 is image-to-video only
  const videoRequiresImage =
    kind === "video" &&
    !!(
      selectedModelObj?.requireImage ||
      /grok-imagine-video-1\.5/i.test(String(selectedModel || ""))
    );

  const [input, setInput] = useState(safeExConfig.defaultInput || "");
  const [refImage, setRefImage] = useState("");
  const [maskImage, setMaskImage] = useState("");
  const [extraValues, setExtraValues] = useState(() =>
    (safeExConfig.extraFields || []).reduce((acc, f) => {
      acc[f.key] = f.default ?? "";
      return acc;
    }, {}),
  );
  const [apiKey, setApiKey] = useState("");
  const [useTunnel, setUseTunnel] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState("");
  const [tunnelEndpoint, setTunnelEndpoint] = useState("");
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(null); // { stage, bytesReceived }
  const [partialImage, setPartialImage] = useState(null);
  const [imageOutputFormat, setImageOutputFormat] = useState("json"); // json | binary
  const [binaryImageUrl, setBinaryImageUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [connections, setConnections] = useState([]);
  const [pinnedConnectionId, setPinnedConnectionId] = useState("");
  const [videoPollStatus, setVideoPollStatus] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const videoAbortRef = useRef(null);
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();
  const { copied: copiedRes, copy: copyRes } = useCopyToClipboard();

  useEffect(() => {
    const timer = setTimeout(() => {
      setLocalEndpoint(window.location.origin);
      fetch("/api/keys")
        .then((r) => r.json())
        .then((d) => {
          setApiKey(
            (d.keys || []).find((k) => k.isActive !== false)?.key || "",
          );
        })
        .catch(() => {});
      fetch("/api/tunnel/status")
        .then((r) => r.json())
        .then((d) => {
          if (d.publicUrl) setTunnelEndpoint(d.publicUrl);
        })
        .catch(() => {});
      fetch("/api/providers", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          const providerIds =
            providerId === "xai"
              ? new Set(["xai", "grok-cli"])
              : new Set([providerId]);
          const conns = (d.connections || [])
            .filter((c) => providerIds.has(c.provider))
            .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
          setConnections(conns);
        })
        .catch(() => {});
    }, 0);

    return () => {
      clearTimeout(timer);
      try {
        videoAbortRef.current?.abort?.();
      } catch {
        /* ignore */
      }
    };
  }, [providerId]);

  // Merge custom models so Example dropdown matches ModelsCard (Add Model)
  useEffect(() => {
    const loadCustom = () => {
      fetch("/api/models/custom", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          const list = (d.models || []).filter(
            (m) =>
              m.providerAlias === providerAlias && (m.type || "llm") === kind,
          );
          setCustomKindModels(list);
        })
        .catch(() => {});
    };
    loadCustom();
    window.addEventListener("focus", loadCustom);
    window.addEventListener("customModelChanged", loadCustom);
    return () => {
      window.removeEventListener("focus", loadCustom);
      window.removeEventListener("customModelChanged", loadCustom);
    };
  }, [providerAlias, kind]);

  // Keep selection valid when custom models arrive / list changes
  const kindModelIds = kindModels.map((m) => m.id).join("\0");
  useEffect(() => {
    if (!needsModel) return;
    if (!kindModelIds) return;
    const ids = kindModelIds.split("\0");
    if (!selectedModel || !ids.includes(selectedModel)) {
      queueMicrotask(() => setSelectedModel(ids[0]));
    }
  }, [kindModelIds, needsModel, selectedModel]);

  if (!kindConfig || !exConfig) return null;

  const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
  const apiPath = kindConfig.endpoint.path;
  const modelFull = !needsModel
    ? safeProviderAlias
    : selectedModel
      ? `${safeProviderAlias}/${selectedModel}`
      : allowManualModel
        ? ""
        : safeProviderAlias;
  const imageEditDefaults = getImageEditDefaults(providerId, selectedModel);
  const effectiveRefImage = refImage.trim() || imageEditDefaults.image || "";
  const effectiveMaskImage =
    maskImage.trim() || imageEditDefaults.mask_image || "";
  const refImagePreviewSrc = toImagePreviewSrc(effectiveRefImage);
  const maskImagePreviewSrc = toImagePreviewSrc(effectiveMaskImage);

  // Build request body with optional extra fields (only non-empty values)
  const extraBodyFromFields = Object.entries(extraValues).reduce(
    (acc, [k, v]) => {
      if (v === "" || v === null || v === undefined) return acc;
      if (typeof v === "number" && Number.isNaN(v)) return acc;
      acc[k] = v;
      return acc;
    },
    {},
  );
  const requestBody = {
    model: modelFull,
    [exConfig.bodyKey]: input,
    ...exConfig.extraBody,
    ...extraBodyFromFields,
    ...(supportsEdit && effectiveRefImage ? { image: effectiveRefImage } : {}),
    ...(supportsMask && effectiveMaskImage
      ? { mask_image: effectiveMaskImage }
      : {}),
  };

  const wantBinary = kind === "image" && imageOutputFormat === "binary";
  const useStreaming =
    kind === "image" && providerId === "codex" && !wantBinary;
  const apiPathWithQuery = `${apiPath}${wantBinary ? "?response_format=binary" : ""}`;
  const headersPreview = `-H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}"${pinnedConnectionId ? ` \\\n  -H "x-connection-id: ${pinnedConnectionId}"` : ""}${useStreaming ? ` \\\n  -H "Accept: text/event-stream"` : ""}`;
  const curlSnippet = `curl -X ${kindConfig.endpoint.method} ${endpoint}${apiPathWithQuery} \\
  ${headersPreview.replace(/\\\n  /g, "\\\n  ")} \\
  -d '${JSON.stringify(requestBody)}'${wantBinary ? " \\\n  --output image.png" : ""}`;

  const handleRun = async () => {
    const isVideoPollOnly =
      kind === "video" && String(extraValues.request_id || "").trim();
    if ((!input.trim() && !isVideoPollOnly) || !modelFull) return;

    const op = String(extraValues.operation || "generations").toLowerCase();
    const isCreateOp = !op || op === "generations";
    if (
      videoRequiresImage &&
      !isVideoPollOnly &&
      isCreateOp &&
      !String(extraValues.image || "").trim()
    ) {
      setError(
        `${selectedModel} is image-to-video only — set Image URL (i2v). For text-to-video use grok-imagine-video.`,
      );
      return;
    }

    try {
      videoAbortRef.current?.abort?.();
    } catch {
      /* ignore */
    }
    const abortCtrl = new AbortController();
    videoAbortRef.current = abortCtrl;

    setRunning(true);
    setError("");
    setResult(null);
    setProgress(null);
    setPartialImage(null);
    setVideoPollStatus("");
    setVideoUrl("");
    if (binaryImageUrl) {
      try {
        URL.revokeObjectURL(binaryImageUrl);
      } catch {}
      setBinaryImageUrl("");
    }
    const start = Date.now();
    try {
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      if (pinnedConnectionId) headers["x-connection-id"] = pinnedConnectionId;
      if (useStreaming) headers["Accept"] = "text/event-stream";
      const body = { ...requestBody, model: modelFull };
      delete body.auto_poll;

      const res = await fetch(`/api${apiPathWithQuery}`, {
        method: kindConfig.endpoint.method,
        headers,
        body: JSON.stringify(body),
        signal: abortCtrl.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message || data?.error || `HTTP ${res.status}`);
        return;
      }
      const ctype = res.headers.get("content-type") || "";
      if (ctype.startsWith("image/")) {
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        setBinaryImageUrl(objUrl);
        setResult({
          data: { binary: true, mime: ctype, size: blob.size },
          latencyMs: Date.now() - start,
        });
        return;
      }
      const isSse = ctype.includes("text/event-stream");
      if (isSse && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let finalData = null;
        let streamErr = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep;
          while ((sep = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            let evt = null,
              dataStr = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) evt = line.slice(6).trim();
              else if (line.startsWith("data:"))
                dataStr += line.slice(5).trim();
            }
            if (!evt) continue;
            try {
              const payload = dataStr ? JSON.parse(dataStr) : {};
              if (evt === "progress") setProgress(payload);
              else if (evt === "partial_image") setPartialImage(payload);
              else if (evt === "done") finalData = payload;
              else if (evt === "error")
                streamErr = payload?.message || "Stream error";
            } catch {}
          }
        }
        const latencyMs = Date.now() - start;
        if (streamErr) {
          setError(streamErr);
          return;
        }
        if (finalData) setResult({ data: finalData, latencyMs });
      } else {
        let data = await res.json();
        const wantAutoPoll =
          kind === "video" &&
          String(extraValues.auto_poll ?? "true") !== "false";
        const requestId =
          typeof data?.request_id === "string" ? data.request_id.trim() : "";
        if (wantAutoPoll && requestId && !data?.video?.url) {
          setVideoPollStatus("pending");
          setResult({ data, latencyMs: Date.now() - start });
          const POLL_MS = 4000;
          const TIMEOUT_MS = 10 * 60 * 1000;
          const pollStart = Date.now();
          while (!abortCtrl.signal.aborted) {
            if (Date.now() - pollStart > TIMEOUT_MS) {
              setError("Video poll timed out (10 min). Use request_id to resume.");
              break;
            }
            await new Promise((r) => setTimeout(r, POLL_MS));
            if (abortCtrl.signal.aborted) break;
            setVideoPollStatus("polling…");
            const pollRes = await fetch(`/api${apiPath}`, {
              method: kindConfig.endpoint.method,
              headers,
              body: JSON.stringify({ model: modelFull, request_id: requestId }),
              signal: abortCtrl.signal,
            });
            const pollData = await pollRes.json().catch(() => ({}));
            if (!pollRes.ok) {
              setError(
                pollData?.error?.message ||
                  pollData?.error ||
                  `HTTP ${pollRes.status}`,
              );
              data = pollData;
              break;
            }
            data = pollData;
            const st = String(pollData?.status || "").toLowerCase();
            setVideoPollStatus(st || "pending");
            setResult({ data: pollData, latencyMs: Date.now() - start });
            if (st === "done" || st === "completed") {
              const url = pollData?.video?.url || pollData?.url || "";
              if (url) setVideoUrl(url);
              break;
            }
            if (st === "failed" || st === "expired") {
              setError(
                pollData?.error?.message ||
                  pollData?.error?.code ||
                  `Video ${st}`,
              );
              break;
            }
          }
        } else {
          const url = data?.video?.url || data?.url || "";
          if (kind === "video" && url) setVideoUrl(url);
          setResult({ data, latencyMs: Date.now() - start });
        }
      }
    } catch (e) {
      if (e?.name === "AbortError") {
        setVideoPollStatus("cancelled");
      } else {
        setError(e.message || "Network error");
      }
    } finally {
      setRunning(false);
    }
  };

  const maskB64 = (obj) => {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(maskB64);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] =
        k === "b64_json" && typeof v === "string" && v.length > 100
          ? `<${v.length} chars base64>`
          : maskB64(v);
    }
    return out;
  };
  const resultJson = result
    ? JSON.stringify(maskB64(result.data), null, 2)
    : "";

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-4">Example</h2>
      <div className="flex flex-col gap-2.5">
        {kindModels.length > 0 ? (
          <Row label="Model">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            >
              {kindModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </select>
          </Row>
        ) : allowManualModel ? (
          <Row label="Model">
            <input
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              placeholder="Enter model id (provider-specific)"
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary font-mono"
            />
          </Row>
        ) : null}

        <Row label="Endpoint">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <span className="w-full min-w-0 flex-1 px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate">
              {endpoint}
              {apiPath}
            </span>
            {tunnelEndpoint && (
              <button
                onClick={() => setUseTunnel((v) => !v)}
                title={useTunnel ? "Using tunnel" : "Using local"}
                className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border shrink-0 transition-colors ${
                  useTunnel
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-text-muted hover:text-primary"
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">
                  wifi_tethering
                </span>
                Tunnel
              </button>
            )}
          </div>
        </Row>

        <Row label="API Key">
          <span className="px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate block">
            {apiKey ? (
              `${apiKey.slice(0, 8)}${"\u2022".repeat(Math.min(20, apiKey.length - 8))}`
            ) : (
              <span className="text-text-muted italic">No key configured</span>
            )}
          </span>
        </Row>

        {connections.length > 0 && (
          <Row
            label="Connection"
            hint="Pin an account for this run (x-connection-id). Auto uses priority/round-robin. Prefer a console.x.ai API key for Imagine; Super Grok OAuth often returns Model not found."
          >
            <select
              value={pinnedConnectionId}
              onChange={(e) => setPinnedConnectionId(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            >
              <option value="">
                Auto (by priority) · {connections.length} accounts
              </option>
              {connections.map((c) => {
                const inactive = c.isActive === false;
                return (
                  <option key={c.id} value={c.id} disabled={inactive}>
                    {inactive ? "[off] " : ""}
                    {formatConnectionLabel(c)}
                    {c.priority != null ? ` · #${c.priority}` : ""}
                  </option>
                );
              })}
            </select>
          </Row>
        )}

        <Row label={exConfig.inputLabel}>
          <div className="relative">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={exConfig.inputPlaceholder}
              className="w-full px-3 py-1.5 pr-7 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            />
            {input && (
              <button
                type="button"
                onClick={() => setInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">
                  close
                </span>
              </button>
            )}
          </div>
        </Row>

        {supportsEdit && (
          <Row label="Ref Image (URL)">
            <div className="flex flex-col gap-2">
              <div className="relative">
                <input
                  value={refImage}
                  onChange={(e) => setRefImage(e.target.value)}
                  placeholder={
                    imageEditDefaults.image || "https://example.com/source.png"
                  }
                  className="w-full px-3 py-1.5 pr-7 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                />
                {refImage && (
                  <button
                    type="button"
                    onClick={() => setRefImage("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary transition-colors"
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      close
                    </span>
                  </button>
                )}
              </div>
              {refImagePreviewSrc && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={refImagePreviewSrc}
                  alt="Reference"
                  className="max-h-40 rounded-lg border border-border object-contain bg-sidebar"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                  onLoad={(e) => {
                    e.currentTarget.style.display = "block";
                  }}
                />
              )}
            </div>
          </Row>
        )}

        {supportsMask && (
          <Row label="Mask (URL)">
            <div className="flex flex-col gap-2">
              <div className="relative">
                <input
                  value={maskImage}
                  onChange={(e) => setMaskImage(e.target.value)}
                  placeholder={
                    imageEditDefaults.mask_image ||
                    "https://example.com/mask.png"
                  }
                  className="w-full px-3 py-1.5 pr-7 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                />
                {maskImage && (
                  <button
                    type="button"
                    onClick={() => setMaskImage("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary transition-colors"
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      close
                    </span>
                  </button>
                )}
              </div>
              {maskImagePreviewSrc && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={maskImagePreviewSrc}
                  alt="Mask"
                  className="max-h-40 rounded-lg border border-border object-contain bg-sidebar"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                  onLoad={(e) => {
                    e.currentTarget.style.display = "block";
                  }}
                />
              )}
            </div>
          </Row>
        )}

        {(exConfig.extraFields || [])
          .filter((f) => {
            if (f.key === "auto_poll" && kind === "video") return true;
            if (kindModels.length === 0) return true;
            if (Array.isArray(selectedModelObj?.params)) {
              return selectedModelObj.params.includes(f.key);
            }
            if (kind === "image") {
              return [
                "n",
                "size",
                "quality",
                "background",
                "response_format",
                "image_detail",
                "output_format",
              ].includes(f.key);
            }
            return false;
          })
          .map((f) => {
            const label =
              f.key === "image" && videoRequiresImage
                ? "Image URL (required)"
                : f.label;
            const hint =
              f.key === "image" && videoRequiresImage
                ? "Required: grok-imagine-video-1.5 is image-to-video only. Text-to-video is not supported — switch to grok-imagine-video for prompt-only."
                : f.hint;
            return (
              <Row key={f.key} label={label} hint={hint}>
                {f.type === "select" ? (
                  <select
                    value={extraValues[f.key] ?? ""}
                    onChange={(e) =>
                      setExtraValues((s) => ({ ...s, [f.key]: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                    title={hint || undefined}
                  >
                    {(f.options || []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt === "" ? "(default)" : opt}
                      </option>
                    ))}
                  </select>
                ) : f.type === "text" ? (
                  <input
                    type="text"
                    value={extraValues[f.key] ?? ""}
                    placeholder={
                      f.key === "image" && videoRequiresImage
                        ? "required start frame URL"
                        : f.placeholder
                    }
                    title={hint || undefined}
                    onChange={(e) =>
                      setExtraValues((s) => ({ ...s, [f.key]: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                  />
                ) : (
                  <input
                    type="number"
                    value={extraValues[f.key] ?? ""}
                    min={f.min}
                    max={f.max}
                    title={hint || undefined}
                    onChange={(e) =>
                      setExtraValues((s) => ({
                        ...s,
                        [f.key]:
                          e.target.value === "" ? "" : Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                  />
                )}
              </Row>
            );
          })}

        {kind === "image" && (
          <Row label="Output Format">
            <select
              value={imageOutputFormat}
              onChange={(e) => setImageOutputFormat(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            >
              <option value="json">JSON (Base64)</option>
              <option value="binary">Binary File</option>
            </select>
          </Row>
        )}

        <div className="mt-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Request
            </span>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <button
                onClick={() => copyCurl(curlSnippet)}
                className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">
                  {copiedCurl ? "check" : "content_copy"}
                </span>
                {copiedCurl ? "Copied" : "Copy"}
              </button>
              <button
                onClick={handleRun}
                disabled={(() => {
                  if (running || !modelFull) return true;
                  const pollOnly =
                    kind === "video" &&
                    String(extraValues.request_id || "").trim();
                  if (!input.trim() && !pollOnly) return true;
                  if (videoRequiresImage && !pollOnly) {
                    const op = String(
                      extraValues.operation || "generations",
                    ).toLowerCase();
                    if (
                      (!op || op === "generations") &&
                      !String(extraValues.image || "").trim()
                    ) {
                      return true;
                    }
                  }
                  return false;
                })()}
                className="flex w-full sm:w-auto items-center justify-center gap-1.5 px-3 py-1 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span
                  className="material-symbols-outlined text-[14px]"
                  style={
                    running
                      ? { animation: "spin 1s linear infinite" }
                      : undefined
                  }
                >
                  play_arrow
                </span>
                {running ? "Running..." : "Run"}
              </button>
              {running && kind === "video" && (
                <button
                  type="button"
                  onClick={() => {
                    try {
                      videoAbortRef.current?.abort?.();
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="flex w-full sm:w-auto items-center justify-center gap-1.5 px-3 py-1 rounded-lg border border-border text-xs font-medium hover:bg-sidebar transition-colors"
                >
                  Cancel poll
                </button>
              )}
            </div>
          </div>
          <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all">
            {curlSnippet}
          </pre>
        </div>

        {kind === "video" && (running || videoPollStatus) && (
          <div className="flex flex-col gap-2 px-3 py-2 rounded-lg bg-sidebar border border-border sm:flex-row sm:items-center sm:gap-3">
            <span
              className="material-symbols-outlined text-[16px] text-primary"
              style={
                running ? { animation: "spin 1s linear infinite" } : undefined
              }
            >
              {running ? "progress_activity" : "check_circle"}
            </span>
            <span className="text-xs text-text-muted">
              Video status: {videoPollStatus || "starting"}
              {providerId === "xai" && (
                <>
                  {" "}
                  · Imagine Video needs a{" "}
                  <strong className="text-text-main">console.x.ai API key</strong>
                  . Super Grok OAuth usually returns Model not found.
                </>
              )}
            </span>
          </div>
        )}

        {(running || progress) && useStreaming && (
          <div className="flex flex-col gap-2 px-3 py-2 rounded-lg bg-sidebar border border-border sm:flex-row sm:items-center sm:gap-3">
            <span
              className="material-symbols-outlined text-[16px] text-primary"
              style={
                running ? { animation: "spin 1s linear infinite" } : undefined
              }
            >
              {running ? "progress_activity" : "check_circle"}
            </span>
            <span className="text-xs text-text-muted">
              {progress?.stage || "starting"}
              {!running && progress?.bytesReceived
                ? ` · ${(progress.bytesReceived / 1024).toFixed(1)} KB`
                : ""}
            </span>
          </div>
        )}

        {partialImage?.b64_json && !result && (
          <div>
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Partial preview
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${partialImage.b64_json}`}
              alt="Partial"
              className="max-w-full rounded-lg border border-border mt-1.5 opacity-80"
            />
          </div>
        )}

        {error && <p className="text-xs text-red-500 break-words">{error}</p>}

        <div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Response{" "}
              {result && (
                <span className="font-normal normal-case">
                  &#9889; {result.latencyMs}ms
                </span>
              )}
            </span>
            {result && (
              <button
                onClick={() => copyRes(resultJson)}
                className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">
                  {copiedRes ? "check" : "content_copy"}
                </span>
                {copiedRes ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap break-all opacity-70">
            {result ? resultJson : exConfig.defaultResponse}
          </pre>
          {kind === "image" && (binaryImageUrl || result?.data?.data?.[0]) && (
            <div className="mt-2">
              <div className="flex items-center justify-end mb-1.5">
                <a
                  href={
                    binaryImageUrl ||
                    (result?.data?.data?.[0]?.b64_json
                      ? `data:image/png;base64,${result.data.data[0].b64_json}`
                      : result?.data?.data?.[0]?.url || "")
                  }
                  download="image.png"
                  className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    download
                  </span>
                  Download
                </a>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={
                  binaryImageUrl ||
                  (result?.data?.data?.[0]?.b64_json
                    ? `data:image/png;base64,${result.data.data[0].b64_json}`
                    : result?.data?.data?.[0]?.url)
                }
                alt="Generated"
                className="max-w-full rounded-lg border border-border"
              />
            </div>
          )}
          {kind === "video" &&
            (videoUrl || result?.data?.video?.url || result?.data?.url) && (
              <div className="mt-2 flex flex-col gap-2">
                <p className="text-xs text-text-muted">
                  Temporary xAI URL — download promptly if you need a copy.
                </p>
                <a
                  href={videoUrl || result?.data?.video?.url || result?.data?.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline break-all"
                >
                  {videoUrl || result?.data?.video?.url || result?.data?.url}
                </a>
                <video
                  controls
                  src={videoUrl || result?.data?.video?.url || result?.data?.url}
                  className="max-w-full rounded-lg border border-border"
                />
              </div>
            )}
        </div>
      </div>
    </Card>
  );
}