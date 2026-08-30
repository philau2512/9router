"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import {
  deletePreset,
  readPresets,
  subscribePresets,
  stripSlash,
  upsertPreset,
} from "./cliEndpointPresets";

const CUSTOM_VALUE = "__custom__";
const SAVE_VALUE = "__save__";

const ensureV1 = (url) => {
  const trimmed = (url || "").replace(/\/+$/, "");
  if (!trimmed) return "";
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
};

const buildOptions = ({
  requiresExternalUrl,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
  cloudEnabled,
  cloudUrl,
  savedPresets,
  withV1,
}) => {
  const wrap = (url) =>
    withV1 ? ensureV1(url) : (url || "").replace(/\/+$/, "");
  const options = [];
  if (!requiresExternalUrl) {
    const url = wrap(`http://127.0.0.1:${UPDATER_CONFIG.appPort}`);
    options.push({ value: "local", label: url, url });
  }
  for (const [enabled, value, url] of [
    [tunnelEnabled, "tunnel", tunnelPublicUrl],
    [tailscaleEnabled, "tailscale", tailscaleUrl],
    [cloudEnabled, "cloud", cloudUrl],
  ]) {
    if (enabled && url) {
      const normalized = wrap(url);
      options.push({ value, label: normalized, url: normalized });
    }
  }
  savedPresets.forEach((preset) =>
    options.push({
      value: `saved:${preset.name}`,
      label: preset.baseUrl,
      url: preset.baseUrl,
      saved: true,
    }),
  );
  options.push({ value: CUSTOM_VALUE, label: "Custom URL...", url: "" });
  return options;
};

export default function BaseUrlSelect({
  value,
  onChange,
  requiresExternalUrl = false,
  tunnelEnabled = false,
  tunnelPublicUrl = "",
  tailscaleEnabled = false,
  tailscaleUrl = "",
  cloudEnabled = false,
  cloudUrl = "",
  withV1 = true,
  currentUrl = "",
}) {
  const [savedPresets, setSavedPresets] = useState(() => readPresets());
  const [mode, setMode] = useState("");
  const [customInput, setCustomInput] = useState("");
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  const initializedRef = useRef(false);
  const customInputRef = useRef("");
  const options = useMemo(
    () =>
      buildOptions({
        requiresExternalUrl,
        tunnelEnabled,
        tunnelPublicUrl,
        tailscaleEnabled,
        tailscaleUrl,
        cloudEnabled,
        cloudUrl,
        savedPresets,
        withV1,
      }),
    [requiresExternalUrl, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl, cloudEnabled, cloudUrl, savedPresets, withV1],
  );

  useEffect(() => {
    const sync = () => {
      const presets = readPresets();
      setSavedPresets(presets);
      setMode((previous) => {
        if (previous !== CUSTOM_VALUE) return previous;
        const typed = stripSlash(customInputRef.current);
        const match = presets.find(
          (preset) => stripSlash(preset.baseUrl) === typed || stripSlash(preset.baseUrl) === stripSlash(ensureV1(typed)),
        );
        return match ? `saved:${match.name}` : previous;
      });
    };
    sync();
    setPresetsLoaded(true);
    return subscribePresets(sync);
  }, []);

  useEffect(() => {
    if (initializedRef.current || !presetsLoaded || options.length === 0) return;
    initializedRef.current = true;
    const current = stripSlash(currentUrl);
    const selected =
      (current && options.find((option) => stripSlash(option.url) === current)) ||
      options.find((option) => option.value !== CUSTOM_VALUE);
    if (selected) {
      setMode(selected.value);
      if (!value) onChange(selected.url);
    } else {
      setMode(CUSTOM_VALUE);
      setCustomInput(value || "");
    }
  }, [currentUrl, onChange, options, presetsLoaded, value]);

  const selectedOption = options.find((option) => option.value === mode);
  const fallback = options.find((option) => option.value !== CUSTOM_VALUE) || options[0];
  const effectiveMode = selectedOption ? mode : fallback?.value || CUSTOM_VALUE;
  const isCustom = effectiveMode === CUSTOM_VALUE;
  const isSaved = effectiveMode.startsWith("saved:");

  const handleSelect = (event) => {
    const next = event.target.value;
    if (next === SAVE_VALUE) {
      const endpoint = (value || "").trim();
      if (!endpoint) return;
      const defaultName = (() => { try { return new URL(endpoint).host; } catch { return endpoint; } })();
      const name = window.prompt("Save endpoint as:", defaultName)?.trim();
      if (!name) return;
      const saved = upsertPreset(endpoint, name);
      if (saved) setMode(`saved:${saved}`);
      return;
    }
    setMode(next);
    if (next === CUSTOM_VALUE) {
      setCustomInput(value || "");
      if (!value) onChange("");
      return;
    }
    const option = options.find((item) => item.value === next);
    if (option) onChange(option.url);
  };

  const handleDelete = () => {
    if (!isSaved) return;
    deletePreset(effectiveMode.slice(6));
    setMode(fallback?.value || CUSTOM_VALUE);
    onChange(fallback?.url || "");
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <select value={effectiveMode} onChange={handleSelect} className="flex-1 min-w-0 px-2 py-2 bg-surface rounded text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5">
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          {isCustom && customInput.trim() && <option value={SAVE_VALUE}>+ Save current as...</option>}
        </select>
        {isSaved && <button type="button" onClick={handleDelete} className="p-1 text-text-muted hover:text-red-500 rounded transition-colors shrink-0" title="Delete saved endpoint"><span className="material-symbols-outlined text-[14px]">delete</span></button>}
      </div>
      {isCustom && <input type="text" value={customInput} onChange={(event) => { const next = event.target.value; customInputRef.current = next; setCustomInput(next); onChange(next); }} placeholder={withV1 ? "https://example.com/v1" : "https://example.com"} className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5" />}
    </div>
  );
}
