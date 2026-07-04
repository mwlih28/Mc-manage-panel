import axios from 'axios';
import { logger } from '../utils/logger';

const REPO_API = 'https://api.github.com/repos/mwlih28/mc-manage-panel';

interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
}

// GitHub's unauthenticated rate limit is 60 req/hour per IP — every admin's
// browser polling this on page load would burn through that fast. Cache the
// release lookup itself, not just the comparison, for an hour.
let cache: { result: UpdateCheckResult; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;

function parseVersion(v: string): number[] | null {
  const match = v.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

// Returns true only if `latest` is strictly greater than `current` — a
// dev build running ahead of the last tagged release (e.g. on a feature
// branch) must never be flagged as "outdated".
function isNewer(current: string, latest: string): boolean {
  const a = parseVersion(current);
  const b = parseVersion(latest);
  if (!a || !b) return current.trim() !== latest.trim();
  for (let i = 0; i < 3; i++) {
    if (b[i] > a[i]) return true;
    if (b[i] < a[i]) return false;
  }
  return false;
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = process.env.PANEL_VERSION || '1.0.0';

  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { ...cache.result, currentVersion };
  }

  try {
    const { data } = await axios.get(`${REPO_API}/releases/latest`, {
      headers: { 'User-Agent': 'Kretase-UpdateCheck/1.0' },
      timeout: 5000,
    });
    const latestVersion: string = data.tag_name;
    const result: UpdateCheckResult = {
      updateAvailable: isNewer(currentVersion, latestVersion),
      currentVersion,
      latestVersion,
      releaseUrl: data.html_url ?? null,
      publishedAt: data.published_at ?? null,
    };
    cache = { result, fetchedAt: Date.now() };
    return result;
  } catch (err) {
    logger.warn(`Update check failed: ${(err as Error).message}`);
    // Don't cache failures — retry on the next request instead of being
    // stuck reporting "no update" for a full hour after a transient error.
    return { updateAvailable: false, currentVersion, latestVersion: null, releaseUrl: null, publishedAt: null };
  }
}
