import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { backfillCodexEmails } from "@/lib/oauth/providers";
import {
  USAGE_APIKEY_PROVIDERS,
  USAGE_SUPPORTED_PROVIDERS,
} from "@/shared/constants/providers";

const SAFE_FIELDS = [
  "id",
  "provider",
  "authType",
  "name",
  "email",
  "displayName",
  "priority",
  "globalPriority",
  "isActive",
  "defaultModel",
  "testStatus",
  "lastError",
  "lastErrorAt",
  "errorCode",
  "expiresAt",
  "lastUsedAt",
  "consecutiveUseCount",
  "createdAt",
  "updatedAt",
];

const SAFE_PSD_FIELDS = [
  "baseUrl",
  "azureEndpoint",
  "deployment",
  "apiVersion",
  "accountId",
  "region",
  "projectId",
  "resourceUrl",
  "proxyPoolId",
  "connectionProxyEnabled",
  "connectionProxyUrl",
  "connectionNoProxy",
  "githubLogin",
  "githubName",
  "githubEmail",
  "githubUserId",
  "username",
  "firstName",
  "lastName",
  "authMethod",
  "authKind",
  "profileArn",
];

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 500;

function maskName(name) {
  if (typeof name !== "string" || name.length <= 16) return name;
  if (/[a-zA-Z0-9_-]{32,}/.test(name)) return `${name.slice(0, 8)}***`;
  return name;
}

function sanitize(c) {
  const safe = {};
  for (const f of SAFE_FIELDS) if (c[f] !== undefined) safe[f] = c[f];
  if (safe.name) safe.name = maskName(safe.name);
  if (c.providerSpecificData) {
    const psd = {};
    for (const f of SAFE_PSD_FIELDS) {
      if (c.providerSpecificData[f] !== undefined)
        psd[f] = c.providerSpecificData[f];
    }
    safe.providerSpecificData = psd;
  }
  return safe;
}

function isUsageEligible(connection) {
  // oauth always; apikey/api_key only when provider is on the usage-apikey whitelist
  // (kiro headless keys use authType "api_key").
  const isOAuth = connection.authType === "oauth";
  const isApikeyAuth =
    connection.authType === "apikey" || connection.authType === "api_key";
  const isApikeyEligible =
    isApikeyAuth && USAGE_APIKEY_PROVIDERS.includes(connection.provider);

  const isAccessTokenEligible =
    connection.authType === "access_token" && connection.provider === "codex";

  return (
    USAGE_SUPPORTED_PROVIDERS.includes(connection.provider) &&
    (isOAuth || isApikeyEligible || isAccessTokenEligible)
  );
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sortConnections(connections, sort) {
  const list = [...connections];

  if (sort === "provider") {
    return list.sort((a, b) => {
      const orderA = USAGE_SUPPORTED_PROVIDERS.indexOf(a.provider);
      const orderB = USAGE_SUPPORTED_PROVIDERS.indexOf(b.provider);
      if (orderA !== orderB) return orderA - orderB;
      return a.provider.localeCompare(b.provider);
    });
  }

  return list.sort((a, b) => {
    const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
    const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return (a.provider || "").localeCompare(b.provider || "");
  });
}

function connectionSearchHaystack(connection) {
  const psd = connection.providerSpecificData || {};
  return [
    connection.name,
    connection.email,
    connection.displayName,
    connection.provider,
    connection.id,
    psd.username,
    psd.githubLogin,
    psd.githubName,
    psd.githubEmail,
    psd.firstName,
    psd.lastName,
    psd.accountId,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ")
    .toLowerCase();
}

function matchesConnectionSearch(connection, search) {
  const query = typeof search === "string" ? search.trim().toLowerCase() : "";
  if (!query) return true;
  return connectionSearchHaystack(connection).includes(query);
}

export async function GET(request) {
  try {
    await backfillCodexEmails();

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") || "all";
    const accountStatus = searchParams.get("accountStatus") || "all";
    const search = searchParams.get("search") || "";
    const sort = searchParams.get("sort") || "priority";
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const pageSize = Math.min(
      parsePositiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );

    const allConnections = await getProviderConnections();
    const eligibleConnections = allConnections.filter(isUsageEligible);
    const providerOptions = Array.from(
      new Set(eligibleConnections.map((conn) => conn.provider)),
    ).sort();

    const providerFilteredConnections = eligibleConnections.filter(
      (conn) => provider === "all" || conn.provider === provider,
    );

    const accountFilteredConnections = providerFilteredConnections.filter(
      (conn) => {
        if (accountStatus === "active") return conn.isActive ?? true;
        if (accountStatus === "inactive") return !(conn.isActive ?? true);
        return true;
      },
    );

    const searchFilteredConnections = accountFilteredConnections.filter(
      (conn) => matchesConnectionSearch(conn, search),
    );

    const sortedConnections = sortConnections(searchFilteredConnections, sort);
    const total = sortedConnections.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * pageSize;
    const pageConnections = sortedConnections
      .slice(offset, offset + pageSize)
      .map(sanitize);

    return NextResponse.json({
      connections: pageConnections,
      providerOptions,
      pagination: {
        page: currentPage,
        pageSize,
        total,
        totalPages,
      },
      totals: {
        eligibleConnections: eligibleConnections.length,
        providerFilteredConnections: providerFilteredConnections.length,
        filteredConnections: total,
      },
    });
  } catch (error) {
    console.log("Error fetching providers for client:", error);
    return NextResponse.json(
      { error: "Failed to fetch providers" },
      { status: 500 },
    );
  }
}
