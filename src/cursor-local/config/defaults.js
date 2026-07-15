/**
 * Defaults for cursor-local — mirrors cursor-byok ports/identity constants.
 */
const crypto = require("crypto");

const DEFAULTS = {
  backendListenAddr: "127.0.0.1:18090",
  proxyListenAddr: "127.0.0.1:18080",
  routerBaseUrl: "http://127.0.0.1:20128",
  // Injected fake Ultra session (local-only; restored on stop)
  injectAccountEmail: "cursor@local.9router",
  // Fake JWT-shaped token — not a real Cursor session
  injectAuthToken:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5cm91dGVyLWN1cnNvci1sb2NhbCIsImVtYWlsIjoiY3Vyc29yQGxvY2FsLjlyb3V0ZXIiLCJ0eXBlIjoic2Vzc2lvbiIsImlzcyI6Ijl5b3V0ZXItY3Vyc29yLWxvY2FsIiwiZXhwIjo0MDcwOTA4ODAwfQ.fake-9router-cursor-local",
  caCommonName: "9Router Cursor-Local Root CA",
  caOrg: "9Router",
  membershipType: "ultra",
  subscriptionStatus: "active",
  signUpType: "Google",
  // Model map: curated via dashboard ModelSelectModal (empty = pick models first)
  models: [],
  restoreAuthOnStop: true,
  restoreSettingsOnStop: true,
};

function stableChannelId(displayName, routerModel) {
  const payload = `${String(displayName || "").trim()}\n${String(routerModel || "").trim()}`;
  return `9r_${crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16)}`;
}

function parseListenAddr(addr, fallback) {
  const raw = String(addr || fallback || "").trim() || fallback;
  const host = raw.includes(":") ? raw.split(":").slice(0, -1).join(":") : "127.0.0.1";
  const port = Number(raw.includes(":") ? raw.split(":").pop() : raw);
  if (!port || port < 1 || port > 65535) {
    throw new Error(`Invalid listen addr: ${addr}`);
  }
  const bindHost =
    !host || host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return { host: bindHost, port, addr: `${bindHost}:${port}` };
}

function proxyUrlFromListenAddr(addr) {
  const { host, port } = parseListenAddr(addr, DEFAULTS.proxyListenAddr);
  return `http://${host}:${port}`;
}

module.exports = {
  DEFAULTS,
  stableChannelId,
  parseListenAddr,
  proxyUrlFromListenAddr,
};
