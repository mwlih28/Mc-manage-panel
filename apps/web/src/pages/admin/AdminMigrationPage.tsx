import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, ArrowLeft, PlugZap, ListChecks, Rocket, CheckCircle2, XCircle, Loader2,
} from 'lucide-react';
import api from '@/lib/axios';
import toast from 'react-hot-toast';
import { Spinner } from '@/components/ui/Spinner';

interface SourceServer {
  id: number;
  uuid: string;
  name: string;
  memory: number;
  disk: number;
  eggId: number;
}

interface JobLogEntry {
  ts: string;
  serverName: string;
  status: 'ok' | 'error';
  message: string;
}

interface Job {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  log: JobLogEntry[];
}

type Step = 'connect' | 'select' | 'run';

export function AdminMigrationPage() {
  const [step, setStep] = useState<Step>('connect');
  const [testing, setTesting] = useState(false);
  const [listing, setListing] = useState(false);
  const [starting, setStarting] = useState(false);

  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [sshHost, setSshHost] = useState('');
  const [sshPort, setSshPort] = useState('22');
  const [sshUsername, setSshUsername] = useState('root');
  const [sshPassword, setSshPassword] = useState('');
  const [sshPrivateKey, setSshPrivateKey] = useState('');
  const [volumesPath, setVolumesPath] = useState('/var/lib/pterodactyl/volumes');

  const [servers, setServers] = useState<SourceServer[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [destinationNodeId, setDestinationNodeId] = useState('');
  const [destinationEggId, setDestinationEggId] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');

  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: nodes = [] } = useQuery({ queryKey: ['admin-nodes-list'], queryFn: () => api.get('/nodes').then((r) => r.data.data || r.data) });
  const { data: eggs = [] } = useQuery({ queryKey: ['admin-eggs-list'], queryFn: () => api.get('/eggs').then((r) => r.data.data) });
  const { data: users = [] } = useQuery({ queryKey: ['admin-users-list'], queryFn: () => api.get('/users', { params: { perPage: 200 } }).then((r) => r.data.data) });

  useEffect(() => {
    if (step !== 'run' || !jobId) return;
    const poll = async () => {
      const { data } = await api.get(`/migrations/${jobId}`);
      setJob(data.data);
      if (data.data.status === 'completed' || data.data.status === 'failed') {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [step, jobId]);

  const testConnection = async () => {
    setTesting(true);
    try {
      await api.post('/migrations/pterodactyl/test', { url, apiKey });
      toast.success('Connected to the source panel');
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(message || 'Connection failed');
    } finally {
      setTesting(false);
    }
  };

  const listServers = async () => {
    setListing(true);
    try {
      const { data } = await api.post('/migrations/pterodactyl/servers', { url, apiKey });
      setServers(data.data);
      setSelected(new Set(data.data.map((s: SourceServer) => s.id)));
      setStep('select');
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(message || 'Failed to list servers');
    } finally {
      setListing(false);
    }
  };

  const toggleSelected = (id: number) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const startImport = async () => {
    if (!destinationNodeId || !destinationEggId || !ownerUserId) {
      toast.error('Pick a destination node, egg, and owner');
      return;
    }
    setStarting(true);
    try {
      const selections = servers
        .filter((s) => selected.has(s.id))
        .map((s) => ({
          sourceServerId: s.id,
          sourceUuid: s.uuid,
          name: s.name,
          memory: s.memory,
          disk: s.disk,
          destinationNodeId,
          destinationEggId,
        }));
      const { data } = await api.post('/migrations/pterodactyl/import', {
        ssh: { host: sshHost, port: parseInt(sshPort, 10), username: sshUsername, password: sshPassword || undefined, privateKey: sshPrivateKey || undefined, volumesPath },
        selections,
        ownerUserId,
      });
      setJobId(data.jobId);
      setJob(null);
      setStep('run');
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(message || 'Failed to start import');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-white">Import from Pterodactyl</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Move existing servers from a Pterodactyl panel into Kretase, including their world/plugin files.
        </p>
      </div>

      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span className={step === 'connect' ? 'text-panel-400 font-medium' : ''}>1. Connect</span>
        <ArrowRight size={12} />
        <span className={step === 'select' ? 'text-panel-400 font-medium' : ''}>2. Select servers</span>
        <ArrowRight size={12} />
        <span className={step === 'run' ? 'text-panel-400 font-medium' : ''}>3. Import</span>
      </div>

      {step === 'connect' && (
        <div className="space-y-4">
          <div className="card">
            <div className="card-header">
              <h2 className="text-sm font-semibold text-zinc-100">Source Panel</h2>
              <p className="text-xs text-zinc-500 mt-0.5">An Application API key from the source Pterodactyl panel (Admin → Application API).</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="label">Panel URL</label>
                <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://panel.example.com" />
              </div>
              <div>
                <label className="label">Application API Key</label>
                <input className="input font-mono text-sm" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="ptla_..." />
              </div>
              <button className="btn-secondary text-xs py-1.5 px-3" onClick={testConnection} disabled={testing || !url || !apiKey}>
                {testing ? <><Spinner size="sm" />Testing...</> : <><PlugZap size={13} />Test Connection</>}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="text-sm font-semibold text-zinc-100">Source File Access</h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                SSH/SFTP access to the Wings host machine where server files actually live, to pull worlds/plugins/jars.
                Only a single source host is supported per import.
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="label">Host</label>
                  <input className="input" value={sshHost} onChange={(e) => setSshHost(e.target.value)} placeholder="wings.example.com" />
                </div>
                <div>
                  <label className="label">Port</label>
                  <input className="input" value={sshPort} onChange={(e) => setSshPort(e.target.value)} placeholder="22" />
                </div>
              </div>
              <div>
                <label className="label">Username</label>
                <input className="input" value={sshUsername} onChange={(e) => setSshUsername(e.target.value)} placeholder="root" />
              </div>
              <div>
                <label className="label">Password</label>
                <input type="password" className="input" value={sshPassword} onChange={(e) => setSshPassword(e.target.value)} />
                <p className="text-xs text-zinc-600 mt-1">Or provide a private key below instead.</p>
              </div>
              <div>
                <label className="label">Private Key (optional)</label>
                <textarea className="input font-mono text-xs min-h-[80px] resize-y" value={sshPrivateKey} onChange={(e) => setSshPrivateKey(e.target.value)} spellCheck={false} />
              </div>
              <div>
                <label className="label">Volumes Path</label>
                <input className="input font-mono text-sm" value={volumesPath} onChange={(e) => setVolumesPath(e.target.value)} />
                <p className="text-xs text-zinc-600 mt-1">Default Pterodactyl install path — change only if customized.</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button className="btn-primary" onClick={listServers} disabled={listing || !url || !apiKey || !sshHost || !sshUsername}>
              {listing ? <><Spinner size="sm" />Loading servers...</> : <><ListChecks size={14} />List Servers</>}
            </button>
          </div>
        </div>
      )}

      {step === 'select' && (
        <div className="space-y-4">
          <div className="card">
            <div className="card-header">
              <h2 className="text-sm font-semibold text-zinc-100">Servers on the source panel</h2>
              <p className="text-xs text-zinc-500 mt-0.5">{servers.length} found — pick which ones to import.</p>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-zinc-800">
              {servers.map((s) => (
                <label key={s.id} className="flex items-center gap-3 px-6 py-3 cursor-pointer hover:bg-white/[0.02]">
                  <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelected(s.id)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-200 truncate">{s.name}</p>
                    <p className="text-xs text-zinc-600 font-mono truncate">{s.uuid}</p>
                  </div>
                  <span className="text-xs text-zinc-500 shrink-0">{s.memory} MB · {s.disk} MB</span>
                </label>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="text-sm font-semibold text-zinc-100">Destination</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Applied to every selected server — mixed destinations aren't supported in this version.</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="label">Node</label>
                <select className="input" value={destinationNodeId} onChange={(e) => setDestinationNodeId(e.target.value)}>
                  <option value="">Select a node…</option>
                  {nodes.map((n: { id: string; name: string }) => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Egg</label>
                <select className="input" value={destinationEggId} onChange={(e) => setDestinationEggId(e.target.value)}>
                  <option value="">Select an egg…</option>
                  {eggs.map((e: { id: string; name: string }) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Owner</label>
                <select className="input" value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)}>
                  <option value="">Select a user…</option>
                  {users.map((u: { id: string; username: string; email: string }) => <option key={u.id} value={u.id}>{u.username} ({u.email})</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button className="btn-secondary" onClick={() => setStep('connect')}><ArrowLeft size={14} />Back</button>
            <button className="btn-primary" onClick={startImport} disabled={starting || selected.size === 0}>
              {starting ? <><Spinner size="sm" />Starting...</> : <><Rocket size={14} />Import {selected.size} Server{selected.size === 1 ? '' : 's'}</>}
            </button>
          </div>
        </div>
      )}

      {step === 'run' && (
        <div className="card">
          <div className="card-header flex items-center gap-2">
            {job?.status === 'running' || !job ? <Loader2 size={14} className="text-panel-400 animate-spin" /> : job.status === 'completed' ? <CheckCircle2 size={14} className="text-emerald-400" /> : <XCircle size={14} className="text-red-400" />}
            <h2 className="text-sm font-semibold text-zinc-100">
              {!job || job.status === 'running' ? 'Importing…' : job.status === 'completed' ? 'Import complete' : 'Import finished with errors'}
            </h2>
          </div>
          <div className="p-6 space-y-2 max-h-96 overflow-y-auto">
            {!job?.log.length && <p className="text-sm text-zinc-500">Waiting for progress…</p>}
            {job?.log.map((entry, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                {entry.status === 'ok' ? <CheckCircle2 size={14} className="text-emerald-400 mt-0.5 shrink-0" /> : <XCircle size={14} className="text-red-400 mt-0.5 shrink-0" />}
                <div>
                  <span className="text-zinc-200 font-medium">{entry.serverName}</span>
                  <span className="text-zinc-500"> — {entry.message}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
