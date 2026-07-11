import https from "https";
import pkg from "../../../../package.json" with { type: "json" };

const NPM_PACKAGE_NAME = "9router";

// Cache npm latest-version lookup for 1 hour — avoids repeat network calls on
// every dashboard load. global survives Next.js hot reload. See upstream a4c5fa4e1.
const VERSION_CACHE_TTL_MS = 60 * 60 * 1000;
const versionCache = (global.__npmVersionCache ??= {
  value: null,
  fetchedAt: 0,
});

// Fetch latest version from npm registry
function fetchLatestVersion() {
  return new Promise((resolve) => {
    const req = https.get(
      `https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`,
      { timeout: 4000 },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data).version || null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

export async function GET() {
  let latestVersion = versionCache.value;
  if (
    !latestVersion ||
    Date.now() - versionCache.fetchedAt >= VERSION_CACHE_TTL_MS
  ) {
    latestVersion = await fetchLatestVersion();
    versionCache.value = latestVersion;
    versionCache.fetchedAt = Date.now();
  }
  const currentVersion = pkg.version;
  const hasUpdate = latestVersion
    ? compareVersions(latestVersion, currentVersion) > 0
    : false;

  return Response.json({ currentVersion, latestVersion, hasUpdate });
}
