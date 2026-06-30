/**
 * Next.js instrumentation hook — runs once on server start (both Node.js and Edge).
 * Used to pre-warm provider connections and DNS cache.
 * See: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */
export async function register() {
  // Only run warmup in Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME !== "edge") {
    try {
      const [{ PROVIDERS }, { warmupProviderAgents }, { warmupDnsCache }] =
        await Promise.all([
          import("./open-sse/config/providers.js"),
          import("./open-sse/utils/connection-pool.js"),
          import("./open-sse/utils/dns-resolver.js"),
        ]);

      // Extract all hostnames from provider baseUrls for DNS pre-warm
      const hostnames = new Set();
      for (const cfg of Object.values(PROVIDERS)) {
        const urls = cfg.baseUrls || (cfg.baseUrl ? [cfg.baseUrl] : []);
        for (const url of urls) {
          try {
            hostnames.add(new URL(url).hostname);
          } catch {
            /* skip */
          }
        }
      }

      // Fire-and-forget — do not await, do not block server start
      Promise.all([
        warmupProviderAgents(PROVIDERS),
        warmupDnsCache([...hostnames]),
      ]).catch((err) =>
        console.warn("[WARMUP] Provider warmup failed:", err?.message || err),
      );
    } catch (err) {
      // Warmup is best-effort — never crash server start
      console.warn("[WARMUP] Init failed:", err?.message || err);
    }
  }
}
