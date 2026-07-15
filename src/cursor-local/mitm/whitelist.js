function normalizeHost(host) {
  let h = String(host || "")
    .trim()
    .toLowerCase();
  if (!h) return "";
  if (h.startsWith("[")) {
    h = h.replace(/^\[/, "").replace(/\]$/, "");
  }
  // strip port
  if (h.includes(":") && !h.includes("::")) {
    const idx = h.lastIndexOf(":");
    if (idx > 0) h = h.slice(0, idx);
  }
  return h;
}

/**
 * MITM only Cursor cloud hosts (cursor-byok isWhitelistedRelayHost).
 */
function isWhitelistedRelayHost(host) {
  const h = normalizeHost(host);
  if (!h) return false;
  if (h === "api2.cursor.sh" || h === "api3.cursor.sh") return true;
  if (h.endsWith(".cursor.sh")) return true;
  return false;
}

module.exports = { isWhitelistedRelayHost, normalizeHost };
