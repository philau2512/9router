/**
 * Kiro IDC provider helpers — cross-region profile ARN discovery.
 *
 * fetchKiroProfileArn: resolve a Q Developer profileArn for an IDC token
 * by querying ListAvailableProfiles across candidate regions.
 * Prefers the profile whose ARN region matches the caller's region.
 *
 * Port of upstream PR #2355 + #2314.
 *
 * NOTE: KiroService.listAvailableProfiles() already picks the best-match ARN
 * for the supplied region and returns it as a string. This helper adds the
 * multi-region retry loop and the in-process TTL cache on top.
 */
import { KiroService } from "./services/kiro.js";

const _kiroService = new KiroService();

// Cache discovered ARNs per access token to avoid redundant API calls.
// TTL: 1 hour. Map<accessToken, {arn, region, expiresAt}>
const _profileArnCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Discover and cache the Q Developer profileArn for an IDC access token.
 * Tries candidate regions in order; KiroService picks the ARN that best
 * matches each region internally.
 *
 * @param {string} accessToken
 * @param {string} callerRegion - Region the token was minted in
 * @returns {Promise<{arn: string, region: string} | null>}
 */
export async function fetchKiroProfileArn(
  accessToken,
  callerRegion = "us-east-1",
  proxyOptions = null,
) {
  // Return cached result if still valid
  const cached = _profileArnCache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) {
    return { arn: cached.arn, region: cached.region };
  }

  // Candidate regions: caller region first, then common fallbacks.
  // Dedupe in case callerRegion is already one of the fallbacks.
  const candidates = [callerRegion, "us-east-1", "eu-central-1"].filter(
    (r, i, arr) => arr.indexOf(r) === i,
  );

  for (const region of candidates) {
    let arn = null;
    try {
      // Returns the best-match ARN string for the given region, or null
      arn = await _kiroService.listAvailableProfiles(
        accessToken,
        region,
        proxyOptions,
      );
    } catch {
      // Region unreachable or rejected — try next candidate
      continue;
    }

    if (!arn) continue;

    const arnRegion = extractRegionFromArn(arn) || region;

    // Cache the result
    _profileArnCache.set(accessToken, {
      arn,
      region: arnRegion,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return { arn, region: arnRegion };
  }

  return null;
}

/**
 * Extract AWS region from a CodeWhisperer profile ARN.
 * e.g. "arn:aws:codewhisperer:eu-central-1:123456:profile/ABC" → "eu-central-1"
 *
 * @param {string} arn
 * @returns {string | null}
 */
export function extractRegionFromArn(arn) {
  if (typeof arn !== "string") return null;
  const parts = arn.split(":");
  return parts.length >= 4 ? parts[3] || null : null;
}
