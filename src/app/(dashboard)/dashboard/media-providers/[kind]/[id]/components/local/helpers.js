"use client";

import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";

// Shared row layout — defined outside components to avoid re-mount on re-render
export function Row({ label, children, hint }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <span
        className="w-full text-xs font-medium text-text-muted sm:w-24 sm:shrink-0 sm:pt-1.5 inline-flex items-center gap-1"
        title={hint || undefined}
      >
        {label}
        {hint ? (
          <span
            className="material-symbols-outlined text-[14px] text-text-muted/70 cursor-help"
            title={hint}
            aria-label={hint}
          >
            info
          </span>
        ) : null}
      </span>
      <div className="w-full min-w-0 flex-1">
        {children}
        {hint ? (
          <p className="mt-1 text-[11px] leading-snug text-text-muted">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}

/** Label for connection picker — name + email when both exist */
export function formatConnectionLabel(c) {
  const name = (c.displayName || c.name || "").trim();
  const email = (c.email || "").trim();
  const auth =
    c.authType === "oauth"
      ? "OAuth"
      : c.authType === "apikey" || c.apiKey
        ? "API key"
        : "";
  const providerTag =
    c.provider === "grok-cli" ? "grok-cli" : c.provider === "xai" ? "xai" : "";
  let base;
  if (name && email && name.toLowerCase() !== email.toLowerCase()) {
    base = `${name} · ${email}`;
  } else {
    base = email || name || c.id?.slice?.(0, 8) || "connection";
  }
  const tags = [auth, providerTag].filter(Boolean).join(" · ");
  return tags ? `${base} (${tags})` : base;
}

export const DEFAULT_TTS_RESPONSE_EXAMPLE = `// Audio will appear here after running.
// Example JSON response (response_format=json):
{
  "format": "mp3",
  "audio": "//NExAANaAIIAUAAANNNNNNNN..." // base64 encoded MP3
}`;

export const DEFAULT_RESPONSE_EXAMPLE = `{
  "object": "list",
  "data": [{
    "object": "embedding",
    "index": 0,
    "embedding": [0.002301, -0.019212, 0.004815, -0.031249, ...]
  }],
  "model": "...",
  "usage": { "prompt_tokens": 9, "total_tokens": 9 }
}`;

export const CLOUDFLARE_TEST_IMAGE_URL =
  "https://pub-1fb693cb11cc46b2b2f656f51e015a2c.r2.dev/dog.png";
export const CLOUDFLARE_TEST_MASK_URL =
  "https://pub-1fb693cb11cc46b2b2f656f51e015a2c.r2.dev/dog-mask.png";

export function getImageEditDefaults(providerId, modelId) {
  if (providerId !== "cloudflare-ai") return {};
  if (modelId === "@cf/runwayml/stable-diffusion-v1-5-img2img") {
    return { image: CLOUDFLARE_TEST_IMAGE_URL };
  }
  if (modelId === "@cf/runwayml/stable-diffusion-v1-5-inpainting") {
    return {
      image: CLOUDFLARE_TEST_IMAGE_URL,
      mask_image: CLOUDFLARE_TEST_MASK_URL,
    };
  }
  return {};
}

export function toImagePreviewSrc(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";
  if (/^(data:image\/|https?:\/\/)/i.test(trimmed)) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}

export function getNowMs() {
  return performance.now();
}

export function getElapsedMs(startMs) {
  return Math.round(getNowMs() - startMs);
}

// Config-driven example defaults per kind
export const KIND_EXAMPLE_CONFIG = {
  webSearch: {
    inputLabel: "Query",
    inputPlaceholder: "What is the latest news about AI?",
    defaultInput: "What is the latest news about AI?",
    bodyKey: "query",
    defaultResponse: `{\n  "results": [\n    { "title": "...", "url": "...", "snippet": "..." }\n  ]\n}`,
    extraFields: [
      {
        key: "search_type",
        label: "Type",
        type: "select",
        default: "web",
        options: ["web", "news"],
      },
      {
        key: "max_results",
        label: "Max results",
        type: "number",
        default: 5,
        min: 1,
        max: 100,
      },
      { key: "country", label: "Country", type: "text", default: "" },
      { key: "language", label: "Language", type: "text", default: "" },
    ],
  },
  webFetch: {
    inputLabel: "URL",
    inputPlaceholder: "https://example.com",
    defaultInput: "https://example.com",
    bodyKey: "url",
    defaultResponse: `{\n  "content": "...",\n  "title": "...",\n  "url": "..."\n}`,
    extraFields: [
      {
        key: "format",
        label: "Format",
        type: "select",
        default: "markdown",
        options: ["markdown", "text", "html"],
      },
      {
        key: "max_characters",
        label: "Max chars",
        type: "number",
        default: 0,
        min: 0,
      },
    ],
  },
  image: {
    inputLabel: "Prompt",
    inputPlaceholder: "A cute cat wearing a hat",
    defaultInput: "A cute cat wearing a hat",
    bodyKey: "prompt",
    defaultResponse: `{\n  "data": [\n    { "url": "...", "b64_json": "..." }\n  ]\n}`,
    extraFields: [
      { key: "n", label: "n", type: "number", default: 1, min: 1, max: 4 },
      {
        key: "size",
        label: "Size",
        type: "select",
        default: "auto",
        options: [
          "auto",
          "1024x1024",
          "1024x1536",
          "1536x1024",
          "1024x1792",
          "1792x1024",
        ],
      },
      {
        key: "quality",
        label: "Quality",
        type: "select",
        default: "auto",
        options: ["auto", "low", "medium", "high", "standard", "hd"],
      },
      {
        key: "background",
        label: "Background",
        type: "select",
        default: "auto",
        options: ["auto", "transparent", "opaque"],
      },
      {
        key: "style",
        label: "Style",
        type: "select",
        default: "",
        options: ["", "vivid", "natural"],
      },
      {
        key: "response_format",
        label: "Format",
        type: "select",
        default: "",
        options: ["", "url", "b64_json"],
      },
      {
        key: "image_detail",
        label: "Image Detail",
        type: "select",
        default: "high",
        options: ["auto", "low", "high", "original"],
      },
      {
        key: "output_format",
        label: "Codec",
        type: "select",
        default: "png",
        options: ["png", "jpeg", "webp"],
      },
    ],
  },
  imageToText: {
    inputLabel: "Image URL",
    inputPlaceholder: "https://example.com/image.png",
    defaultInput:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/1200px-Cat03.jpg",
    bodyKey: "url",
    extraBody: { prompt: "Describe this image in detail" },
    defaultResponse: `{\n  "text": "A cat sitting on a windowsill...",\n  "model": "..."\n}`,
  },
  video: {
    inputLabel: "Prompt",
    inputPlaceholder: "A serene lake at sunset, cinematic, 4k",
    defaultInput: "A serene lake at sunset, cinematic, 4k",
    bodyKey: "prompt",
    defaultResponse: `{
  "request_id": "...",
  "status": "pending"
}`,
    extraFields: [
      {
        key: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        default: "16:9",
        options: ["", "16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"],
        hint: "Output frame ratio. Default 16:9. Image-to-video defaults to the source image ratio unless you set this.",
      },
      {
        key: "resolution",
        label: "Resolution",
        type: "select",
        default: "480p",
        options: ["", "480p", "720p", "1080p"],
        hint: "480p (default, faster) · 720p HD · 1080p only on grok-imagine-video-1.5 for image-to-video. Higher res = slower + more cost.",
      },
      {
        key: "duration",
        label: "Duration (s)",
        type: "number",
        default: 5,
        min: 1,
        max: 15,
        hint: "xAI Imagine allows 1–15 seconds per clip. Billed per second of output. Edits keep the source video length (max ~8.7s).",
      },
      {
        key: "image",
        label: "Image URL (i2v)",
        type: "text",
        default: "",
        placeholder: "https://… or data:image/…;base64,…",
        hint: "Image-to-video start frame (URL / data URL / file id). Required for grok-imagine-video-1.5 — that model does not support text-only. Do not combine with reference_images.",
      },
      {
        key: "video",
        label: "Video URL",
        type: "text",
        default: "",
        placeholder: "required for edits / extensions",
        hint: "Source video for Operation = edits or extensions (public URL / data URL / file id).",
      },
      {
        key: "reference_images",
        label: "Reference images",
        type: "text",
        default: "",
        placeholder: "comma-separated URLs (base model only)",
        hint: "Reference-to-video: style/subject guides without forcing first frame. Supported on grok-imagine-video only — not on 1.5. Comma or newline separated.",
      },
      {
        key: "operation",
        label: "Operation",
        type: "select",
        default: "",
        options: ["", "generations", "edits", "extensions"],
        hint: "generations = text/image-to-video · edits = change an existing video · extensions = continue from last frame. Leave empty for create.",
      },
      {
        key: "request_id",
        label: "Poll request_id",
        type: "text",
        default: "",
        placeholder: "leave empty to create; set to poll status",
        hint: "After create, API returns request_id. Paste it here (or enable Auto-poll) to poll GET until status=done.",
      },
      {
        key: "auto_poll",
        label: "Auto-poll",
        type: "select",
        default: "true",
        options: ["true", "false"],
        hint: "When true, after create the playground polls every ~4s for up to 10 minutes until done/failed/expired. Video URLs are temporary — download promptly.",
      },
    ],
  },
  music: {
    inputLabel: "Prompt",
    inputPlaceholder: "A calm piano melody",
    defaultInput: "A calm piano melody",
    bodyKey: "prompt",
    defaultResponse: `{\n  "data": [\n    { "url": "...", "format": "mp3" }\n  ]\n}`,
  },
};