import axios from 'axios';

// PaperMC's old api.papermc.io/v2 was sunset (HTTP 410). The new API lives at
// fill.papermc.io/v3, has a different response shape, and requires a real,
// identifying User-Agent header.
const PAPER_API_BASE = 'https://fill.papermc.io/v3/projects/paper';
const PAPER_USER_AGENT = 'Kretase/1.0 (+https://kretase.com)';

export async function fetchPaperVersions(): Promise<string[]> {
  const { data } = await axios.get(PAPER_API_BASE, { timeout: 10000, headers: { 'User-Agent': PAPER_USER_AGENT } });
  return Object.values(data.versions as Record<string, string[]>).flat();
}

export interface PaperBuild {
  id: number;
  time: string;
  channel: string;
  commits: { sha: string; message: string; time: string }[];
}

export async function fetchPaperBuildDetails(version: string): Promise<PaperBuild[]> {
  const { data } = await axios.get(`${PAPER_API_BASE}/versions/${version}/builds`, {
    timeout: 10000, headers: { 'User-Agent': PAPER_USER_AGENT },
  });
  return (data as PaperBuild[]).map((b) => ({
    id: b.id,
    time: b.time,
    channel: b.channel,
    commits: (b.commits || []).map((c) => ({ sha: c.sha, message: c.message, time: c.time })),
  }));
}

export async function fetchPaperBuilds(version: string): Promise<number[]> {
  const builds = await fetchPaperBuildDetails(version);
  return builds.map((b) => b.id);
}
