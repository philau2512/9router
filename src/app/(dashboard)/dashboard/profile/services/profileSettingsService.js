const JSON_HEADERS = { "Content-Type": "application/json" };

async function readJson(response) {
  return response.json().catch(() => ({}));
}

export async function fetchSettings() {
  const response = await fetch("/api/settings");
  if (!response.ok) return null;
  return response.json();
}

export async function patchSettings(payload) {
  const response = await fetch("/api/settings", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  const data = await readJson(response);
  return { ok: response.ok, data };
}

export async function testProxyUrl(proxyUrl) {
  const response = await fetch("/api/settings/proxy-test", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ proxyUrl }),
  });
  const data = await readJson(response);
  return { ok: response.ok, data };
}

export async function testOidcSettings(payload) {
  const response = await fetch("/api/auth/oidc/test", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  const data = await readJson(response);
  return { ok: response.ok, data };
}

export function getDatabaseBackupUrl({ includeUsageAnalytics }) {
  return includeUsageAnalytics
    ? "/api/settings/database?includeUsageAnalytics=true"
    : "/api/settings/database";
}

export async function exportDatabaseBackup({ includeUsageAnalytics }) {
  const response = await fetch(getDatabaseBackupUrl({ includeUsageAnalytics }));
  const data = await readJson(response);
  return { ok: response.ok, data };
}

export async function importDatabaseBackup(payload) {
  const response = await fetch("/api/settings/database", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  const data = await readJson(response);
  return { ok: response.ok, data };
}

export async function importSqliteDatabaseBackup(file) {
  const response = await fetch("/api/settings/database", {
    method: "POST",
    headers: { "Content-Type": "application/vnd.sqlite3" },
    body: file,
  });
  const data = await readJson(response);
  return { ok: response.ok, data };
}
