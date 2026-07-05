import axios from 'axios';
import { parsePterodactylEgg, resolveNestId, createEggFromParsed } from './eggImport';

// pelican-eggs is the actively-maintained successor to the long-standing
// parkervcp/eggs community repo (which announced its own end-of-life and
// migration here — see its README) — real, community-vetted Pterodactyl-
// format eggs with real Docker images, split across these category repos.
// Fetched live (not vendored) so the catalog grows as that project grows,
// and cached briefly since the tree rarely changes minute-to-minute.
export const EGG_STORE_CATEGORIES = [
  { slug: 'minecraft', repo: 'minecraft', label: 'Minecraft' },
  { slug: 'steamcmd', repo: 'steamcmd', label: 'SteamCMD Games' },
  { slug: 'games', repo: 'games', label: 'Other Games' },
  { slug: 'voice', repo: 'voice', label: 'Voice Servers' },
  { slug: 'database', repo: 'database', label: 'Databases' },
  { slug: 'chatbots', repo: 'chatbots', label: 'Chat Bots' },
  { slug: 'generic', repo: 'generic', label: 'Generic / Docker' },
  { slug: 'software', repo: 'software', label: 'Software' },
  { slug: 'monitoring', repo: 'monitoring', label: 'Monitoring' },
  { slug: 'storage', repo: 'storage', label: 'Storage' },
  { slug: 'tooling', repo: 'tooling', label: 'Tooling' },
] as const;

const ORG = 'pelican-eggs';
const BRANCH = 'main';
const CATEGORY_SLUGS = new Set(EGG_STORE_CATEGORIES.map((c) => c.slug));

export interface StoreEggEntry {
  path: string;
  name: string;
  group: string;
}

interface JsdelivrFile {
  type: 'file' | 'directory';
  name: string;
  files?: JsdelivrFile[];
}

interface CacheEntry { data: StoreEggEntry[]; expiresAt: number; }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000;

// A path we're about to interpolate into a raw.githubusercontent.com URL —
// reject anything that isn't a plain relative json path (no traversal, no
// scheme, no leading slash) even though it's already constrained to a
// whitelisted org/repo below.
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9_\-./ ]*\.json$/;
function isSafePath(path: string): boolean {
  return SAFE_PATH.test(path) && !path.includes('..');
}

function slugToRepo(slug: string): string {
  const cat = EGG_STORE_CATEGORIES.find((c) => c.slug === slug);
  if (!cat) throw new Error('Unknown egg store category');
  return cat.repo;
}

function flatten(files: JsdelivrFile[], prefix = ''): string[] {
  const out: string[] = [];
  for (const f of files) {
    const p = prefix ? `${prefix}/${f.name}` : f.name;
    if (f.type === 'directory') out.push(...flatten(f.files || [], p));
    else out.push(p);
  }
  return out;
}

function humanize(segment: string): string {
  return segment.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function listCategoryEggs(slug: string): Promise<StoreEggEntry[]> {
  if (!CATEGORY_SLUGS.has(slug as (typeof EGG_STORE_CATEGORIES)[number]['slug'])) {
    throw new Error('Unknown egg store category');
  }
  const repo = slugToRepo(slug);

  const cached = cache.get(repo);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const { data } = await axios.get(
    `https://data.jsdelivr.com/v1/packages/gh/${ORG}/${repo}@${BRANCH}`,
    { timeout: 15000 }
  );
  const allPaths = flatten(data.files || []);
  const jsonEggs = allPaths.filter((p) => {
    const fn = p.split('/').pop() || '';
    return fn.startsWith('egg-') && fn.endsWith('.json') && isSafePath(p);
  });

  // The same egg is frequently exported twice in this repo — a plain
  // "egg-x.json" (Pelican's own format) and an "egg-pterodactyl-x.json"
  // (this ecosystem's format, which is what we are) for the same folder.
  // Keep one per folder, preferring the pterodactyl-labelled file.
  const byDir = new Map<string, string>();
  for (const p of jsonEggs) {
    const dir = p.slice(0, p.lastIndexOf('/'));
    const fn = p.split('/').pop() || '';
    const existing = byDir.get(dir);
    if (!existing || (fn.includes('pterodactyl') && !existing.includes('pterodactyl'))) {
      byDir.set(dir, p);
    }
  }

  const entries: StoreEggEntry[] = Array.from(byDir.entries())
    .map(([dir, path]) => {
      const segments = dir.split('/');
      return {
        path,
        name: humanize(segments[segments.length - 1]),
        group: segments.length > 1 ? humanize(segments[0]) : '',
      };
    })
    .sort((a, b) => (a.group + a.name).localeCompare(b.group + b.name));

  cache.set(repo, { data: entries, expiresAt: Date.now() + CACHE_TTL_MS });
  return entries;
}

async function fetchStoreEggJson(slug: string, path: string): Promise<unknown> {
  if (!CATEGORY_SLUGS.has(slug as (typeof EGG_STORE_CATEGORIES)[number]['slug'])) {
    throw new Error('Unknown egg store category');
  }
  if (!isSafePath(path)) throw new Error('Invalid egg path');
  const repo = slugToRepo(slug);

  const { data } = await axios.get(
    `https://raw.githubusercontent.com/${ORG}/${repo}/${BRANCH}/${path}`,
    { timeout: 15000, responseType: 'text', transformResponse: (d) => d }
  );
  return JSON.parse(data as string);
}

export async function importStoreEgg(
  slug: string, path: string, nestInput: { nestId?: string; nestName?: string }
) {
  const json = await fetchStoreEggJson(slug, path);
  const parsed = parsePterodactylEgg(json);
  const nestId = await resolveNestId(nestInput);
  return createEggFromParsed(parsed, nestId);
}

export interface BulkImportResult {
  path: string;
  success: boolean;
  eggId?: string;
  error?: string;
}

// Sequential, not parallel — this hits a free public CDN on the community's
// behalf; a burst of 100+ concurrent requests for a "select all" click would
// be an inconsiderate way to use it, and there's no latency budget here
// worth optimizing for (this is an infrequent admin bulk action).
export async function importStoreEggsBulk(
  slug: string, paths: string[], nestInput: { nestId?: string; nestName?: string }
): Promise<BulkImportResult[]> {
  const results: BulkImportResult[] = [];
  const nestId = await resolveNestId(nestInput);
  for (const path of paths) {
    try {
      const json = await fetchStoreEggJson(slug, path);
      const parsed = parsePterodactylEgg(json);
      const egg = await createEggFromParsed(parsed, nestId);
      results.push({ path, success: true, eggId: egg.id });
    } catch (err) {
      results.push({ path, success: false, error: (err as Error).message });
    }
  }
  return results;
}
