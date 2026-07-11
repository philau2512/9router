// SSRF guard: block internal/private/metadata targets for server-side fetch.

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
]);
const BLOCKED_SUFFIXES = [".internal", ".local", ".localhost"];

// Parse dotted IPv4 to 32-bit integer, or null if not a valid IPv4 literal.
function ipv4ToInt(host) {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

// Private/reserved IPv4 ranges as [startInt, maskBits].
const BLOCKED_V4_RANGES = [
  [ipv4ToInt("0.0.0.0"), 8],
  [ipv4ToInt("10.0.0.0"), 8],
  [ipv4ToInt("127.0.0.0"), 8],
  [ipv4ToInt("169.254.0.0"), 16],
  [ipv4ToInt("172.16.0.0"), 12],
  [ipv4ToInt("192.168.0.0"), 16],
];

function isBlockedIpv4(host) {
  const ip = ipv4ToInt(host);
  if (ip === null) return false;
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ip & mask) === (base & mask);
  });
}

// Check if a 32-bit integer falls in a blocked range (for non-dotted IP forms).
function isBlockedIpv4Int(ip) {
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ip & mask) === (base & mask);
  });
}

function isBlockedIpv6(host) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd"))
    return true;
  // IPv4-mapped IPv6 (::ffff:1.2.3.4 or ::ffff:7f00:1).
  // Node's fetch resolves these to the embedded IPv4 — must block both forms.
  if (h.startsWith("::ffff:")) {
    const embedded = h.slice("::ffff:".length);
    // Dotted-decimal form: ::ffff:127.0.0.1
    if (isBlockedIpv4(embedded)) return true;
    // Hex group form: ::ffff:7f00:1 — two colon-separated 16-bit groups
    const hexParts = embedded.split(":");
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0], 16);
      const lo = parseInt(hexParts[1], 16);
      if (!isNaN(hi) && !isNaN(lo))
        if (isBlockedIpv4Int(((hi << 16) | lo) >>> 0)) return true;
    }
  }
  return false;
}

// Throw if URL targets a non-public host. Caller should map to 400.
export function assertPublicUrl(rawUrl) {
  const parsed = new URL(rawUrl);

  // Only allow HTTP/HTTPS — reject file://, ftp://, etc.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("Blocked URL: non-HTTP protocol");

  const host = parsed.hostname.toLowerCase();

  // Decimal integer IP notation (e.g. http://2130706433/ == 127.0.0.1).
  // Some platforms resolve bare integers to IPv4 — block proactively.
  if (/^\d+$/.test(host)) {
    const ip = (Number(host) & 0xffffffff) >>> 0;
    if (isBlockedIpv4Int(ip)) throw new Error("Blocked URL: private IP");
  }

  if (BLOCKED_HOSTNAMES.has(host))
    throw new Error("Blocked URL: internal host");
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s)))
    throw new Error("Blocked URL: internal host");
  if (isBlockedIpv4(host)) throw new Error("Blocked URL: private IP");
  if (host.includes(":") && isBlockedIpv6(host))
    throw new Error("Blocked URL: private IP");
}
