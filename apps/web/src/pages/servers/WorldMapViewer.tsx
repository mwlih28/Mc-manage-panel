import { useState, useEffect, useCallback, useRef } from 'react';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/Spinner';
import { Map, RefreshCw, Download, Crosshair, Info } from 'lucide-react';

const RADIUS_OPTIONS = [128, 256, 512, 1024];

interface AxiosBlobError {
  response?: { data?: Blob };
}

export function WorldMapViewer({ serverId }: { serverId: string }) {
  const [radius, setRadius] = useState(256);
  const [centerXInput, setCenterXInput] = useState('');
  const [centerZInput, setCenterZInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [chunksRendered, setChunksRendered] = useState(0);
  const [actualCenter, setActualCenter] = useState<{ x: number; z: number } | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const loadMap = useCallback(async (centerX?: number, centerZ?: number) => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, number> = { radius };
      if (centerX !== undefined && centerZ !== undefined) {
        params.centerX = centerX;
        params.centerZ = centerZ;
      }
      const res = await api.get(`/servers/${serverId}/world/map`, { params, responseType: 'blob' });
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(res.data as Blob);
      objectUrlRef.current = url;
      setImageUrl(url);
      setChunksRendered(Number(res.headers['x-map-chunks-rendered'] ?? 0));
      const cx = Number(res.headers['x-map-center-x'] ?? 0);
      const cz = Number(res.headers['x-map-center-z'] ?? 0);
      setActualCenter({ x: cx, z: cz });
      setCenterXInput(String(cx));
      setCenterZInput(String(cz));
    } catch (err) {
      let message = 'Failed to render world map';
      const blob = (err as AxiosBlobError).response?.data;
      if (blob instanceof Blob) {
        try { message = JSON.parse(await blob.text()).message || message; } catch { /* ignore */ }
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [serverId, radius]);

  useEffect(() => { loadMap(); }, [radius]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); }, []);

  const goToCoords = () => {
    const x = parseInt(centerXInput, 10);
    const z = parseInt(centerZInput, 10);
    if (Number.isNaN(x) || Number.isNaN(z)) {
      toast.error('Enter valid X and Z coordinates');
      return;
    }
    loadMap(x, z);
  };

  const recenterOnSpawn = () => loadMap();

  const downloadMap = () => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `world-map-${actualCenter?.x ?? 0}-${actualCenter?.z ?? 0}-r${radius}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Map size={15} /> World Map
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              A top-down render of real terrain, generated directly from the world's saved region files.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="input py-1.5 text-xs w-auto"
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
            >
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>{r * 2}×{r * 2} blocks</option>
              ))}
            </select>
            <button className="btn-secondary btn-sm" onClick={() => loadMap(actualCenter?.x, actualCenter?.z)} disabled={loading}>
              {loading ? <Spinner size="sm" /> : <RefreshCw size={13} />} Refresh
            </button>
            <button className="btn-secondary btn-sm" onClick={downloadMap} disabled={!imageUrl}>
              <Download size={13} /> Save PNG
            </button>
          </div>
        </div>

        <div className="p-4 border-b border-dark-800 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500">Center on:</span>
          <input
            type="number"
            className="input py-1.5 text-xs w-24 font-mono"
            placeholder="X"
            value={centerXInput}
            onChange={(e) => setCenterXInput(e.target.value)}
          />
          <input
            type="number"
            className="input py-1.5 text-xs w-24 font-mono"
            placeholder="Z"
            value={centerZInput}
            onChange={(e) => setCenterZInput(e.target.value)}
          />
          <button className="btn-secondary btn-sm" onClick={goToCoords} disabled={loading}>
            Go
          </button>
          <button className="btn-secondary btn-sm" onClick={recenterOnSpawn} disabled={loading}>
            <Crosshair size={13} /> Spawn
          </button>
          {actualCenter && (
            <span className="text-xs text-slate-600 ml-auto font-mono">
              Centered at {actualCenter.x}, {actualCenter.z} · {chunksRendered} chunk(s) rendered
            </span>
          )}
        </div>

        <div className="p-4">
          {loading ? (
            <div className="flex justify-center py-20"><Spinner size="lg" /></div>
          ) : error ? (
            <div className="text-center py-16 text-slate-500">
              <Map size={32} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">{error}</p>
              <p className="text-xs text-slate-600 mt-1">The server may need to be started at least once so its world exists on disk.</p>
            </div>
          ) : imageUrl ? (
            <div className="overflow-auto rounded-lg border border-dark-700 bg-dark-950" style={{ maxHeight: '70vh' }}>
              <img
                src={imageUrl}
                alt="World map"
                style={{ imageRendering: 'pixelated', display: 'block' }}
              />
            </div>
          ) : null}
        </div>

        <div className="px-4 pb-4 flex items-start gap-2 text-[11px] text-slate-600">
          <Info size={12} className="shrink-0 mt-0.5" />
          <span>
            This is a snapshot, not a live map — colors reflect real blocks (grass, water, sand, stone, etc.)
            read straight from the world save at the time you hit Refresh. Rebuild the render after players
            explore or build somewhere new.
          </span>
        </div>
      </div>
    </div>
  );
}
