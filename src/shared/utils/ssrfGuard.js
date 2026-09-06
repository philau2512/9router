// SSRF guard: block internal/private/metadata targets for server-side fetch.
//
// Three layers close distinct bypass classes:
// 1. assertPublicUrl validates literal hosts synchronously.
// 2. assertPublicUrlResolved also checks DNS answers.
// 3. fetchPublic validates every redirect target before fetching it.

import dns from "node:dns";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
]);
const BLOCKED_SUFFIXES = [".internal", ".local", ".localhost"];

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

const BLOCKED_V4_RANGES = [
  [ipv4ToInt("0.0.0.0"), 8],
  [ipv4ToInt("10.0.0.0"), 8],
  [ipv4ToInt("100.64.0.0"), 10],
  [ipv4ToInt("127.0.0.0"), 8],
  [ipv4ToInt("169.254.0.0"), 16],
  [ipv4ToInt("172.16.0.0"), 12],
  [ipv4ToInt("192.168.0.0"), 16],
];

function isBlockedIpv4Int(ip) {
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ip & mask) === (base & mask);
  });
}

function isBlockedIpv4(host) {
  const ip = ipv4ToInt(host);
  return ip !== null && isBlockedIpv4Int(ip);
}

function parseHextets(value) {
  if (value === "") return [];
  const groups = [];
  for (const part of value.split(":")) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    groups.push(parseInt(part, 16));
  }
  return groups;
}

function parseIpv6ToGroups(rawHost) {
  let host = rawHost.toLowerCase();
  const v4Tail = host.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  let v4Groups = null;
  if (v4Tail) {
    const v4 = ipv4ToInt(v4Tail[1]);
    if (v4 === null) return null;
    v4Groups = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    host = host.slice(0, host.length - v4Tail[1].length);
    if (!host.endsWith("::") && host.endsWith(":")) host = host.slice(0, -1);
  }

  const parts = host.split("::");
  if (parts.length > 2) return null;
  let groups;
  if (parts.length === 2) {
    const head = parseHextets(parts[0]);
    const tail = parseHextets(parts[1]);
    if (head === null || tail === null) return null;
    const missing = 8 - head.length - tail.length - (v4Groups?.length || 0);
    if (missing < 0) return null;
    groups = [...head, ...new Array(missing).fill(0), ...tail, ...(v4Groups || [])];
  } else {
    const parsed = parseHextets(host);
    if (parsed === null) return null;
    groups = [...parsed, ...(v4Groups || [])];
  }
  return groups.length === 8 ? groups : null;
}

function isBlockedIpv6Groups(groups) {
  if (groups.length !== 8) return false;
  const isZero = (index) => groups[index] === 0;
  if ([0, 1, 2, 3, 4, 5, 6].every(isZero) && groups[7] === 1) return true;
  if (groups.every((group) => group === 0)) return true;
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  if ((groups[0] & 0xfe00) === 0xfc00) return true;

  const low32 = ((groups[6] << 16) | groups[7]) >>> 0;
  if ([0, 1, 2, 3, 4].every(isZero) && groups[5] === 0xffff)
    return isBlockedIpv4Int(low32);
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && [2, 3, 4, 5].every(isZero))
    return isBlockedIpv4Int(low32);
  if ([0, 1, 2, 3, 4, 5].every(isZero) && low32 !== 0 && low32 !== 1)
    return isBlockedIpv4Int(low32);
  return false;
}

function normalizeHost(hostname) {
  return hostname.toLowerCase().replace(/\.+$/, "");
}

function isBlockedHost(host) {
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (isBlockedIpv4(host)) return true;
  if (host.includes(":")) {
    const groups = parseIpv6ToGroups(host.replace(/^\[|\]$/g, ""));
    if (groups && isBlockedIpv6Groups(groups)) return true;
  }
  return false;
}

function parsePublicHttpUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("Blocked URL: non-HTTP protocol");
  return parsed;
}

export function assertPublicUrl(rawUrl) {
  const parsed = parsePublicHttpUrl(rawUrl);
  const host = normalizeHost(parsed.hostname);
  if (isBlockedHost(host)) throw new Error("Blocked URL: internal host");
}

export async function assertPublicUrlResolved(rawUrl) {
  const parsed = parsePublicHttpUrl(rawUrl);
  const host = normalizeHost(parsed.hostname);
  if (isBlockedHost(host)) throw new Error("Blocked URL: internal host");

  const bracketless = host.replace(/^\[|\]$/g, "");
  if (ipv4ToInt(bracketless) !== null || bracketless.includes(":")) return;

  let addresses;
  try {
    addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    return;
  }
  for (const { address, family } of addresses) {
    const blocked = family === 4
      ? isBlockedIpv4(address)
      : isBlockedIpv6Groups(parseIpv6ToGroups(address) || []);
    if (blocked) throw new Error("Blocked URL: hostname resolves to an internal host");
  }
}

export async function fetchPublic(url, init = {}, { maxRedirects = 5 } = {}) {
  await assertPublicUrlResolved(url);
  let currentUrl = url;
  for (let hop = 0; ; hop++) {
    const response = await fetch(currentUrl, { ...init, redirect: "manual" });
    const location = response.status >= 300 && response.status < 400
      ? response.headers.get("location")
      : null;
    if (!location) return response;
    if (hop >= maxRedirects) throw new Error("Blocked URL: too many redirects");
    currentUrl = new URL(location, currentUrl).toString();
    await assertPublicUrlResolved(currentUrl);
  }
}
