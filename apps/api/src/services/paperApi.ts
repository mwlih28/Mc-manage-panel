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

export async function fetchPaperBuilds(version: string): Promise<number[]> {
  const { data } = await axios.get(`${PAPER_API_BASE}/versions/${version}/builds`, {
    timeout: 10000, headers: { 'User-Agent': PAPER_USER_AGENT },
  });
  return (data as { id: number }[]).map((b) => b.id);
}
