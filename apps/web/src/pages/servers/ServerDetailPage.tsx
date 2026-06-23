import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Play, Square, RotateCcw, Zap, Terminal, BarChart2,
  HardDrive, Archive, ChevronLeft, Cpu, MemoryStick,
  Folder, FolderOpen, File, ChevronRight, ArrowLeft, Pencil, Trash2, Plus, X, Check,
  Package, Users, Search, Download, RefreshCw, Tag, AlertTriangle
} from 'lucide-react';
import { io as ioClient, Socket } from 'socket.io-client';
import api from '@/lib/axios';
import { useAuthStore } from '@/store/authStore';
import { Server, ServerStats, ServerStatus } from '@/types';
import {
  getServerStatusDot, getServerStatusBadge, formatBytes, formatUptime
} from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

type Tab = 'console' | 'files' | 'plugins' | 'versions' | 'stats' | 'backups';

interface ModrinthProject {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  downloads: number;
  icon_url?: string;
}

interface ModrinthVersion {
  id: string;
  loaders: string[];
  game_versions: string[];
  files: { url: string; filename: string; primary: boolean }[];
}

interface FileEntry {
  name: string;
  mode: string;
  size: number;
  isFile: boolean;
  isDir: boolean;
  isSymlink: boolean;
  modifiedAt: string;
}

interface ConsoleLine {
  type: 'output' | 'input' | 'status';
  data: string;
  timestamp: number;
}

interface NbtItem { slot: number; id: string; count: number; }

export function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { accessToken } = useAuthStore();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('console');
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [command, setCommand] = useState('');
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [currentStatus, setCurrentStatus] = useState<ServerStatus>('OFFLINE');
  const socketRef = useRef<Socket | null>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['server', id],
    queryFn: () => api.get(`/servers/${id}`).then((r) => r.data.data as Server),
    enabled: !!id,
  });

  const [currentDir, setCurrentDir] = useState('/');
  const [editingFile, setEditingFile] = useState<{ path: string; content: string } | null>(null);
  const [editContent, setEditContent] = useState('');
  const [savingFile, setSavingFile] = useState(false);

  // Plugins / Modrinth
  const [pluginQuery, setPluginQuery] = useState('');
  const [pluginResults, setPluginResults] = useState<ModrinthProject[]>([]);
  const [pluginLoading, setPluginLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  // Installed plugins
  const [installedPlugins, setInstalledPlugins] = useState<FileEntry[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [deletingPlugin, setDeletingPlugin] = useState<string | null>(null);

  // Version management
  const [versions, setVersions] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [builds, setBuilds] = useState<number[]>([]);
  const [selectedBuild, setSelectedBuild] = useState<number | 'latest'>('latest');
  const [versionLoading, setVersionLoading] = useState(false);
  const [installing_version, setInstallingVersion] = useState(false);

  // Players
  const [players, setPlayers] = useState<{ online: number; max: number; names: string[] }>({ online: 0, max: 0, names: [] });
  const [onlinePlayers, setOnlinePlayers] = useState<{ name: string; uuid: string }[]>([]);
  const [inventoryPlayer, setInventoryPlayer] = useState<{ name: string; uuid: string } | null>(null);
  const [playerInventory, setPlayerInventory] = useState<{ inventory: NbtItem[]; enderChest: NbtItem[] } | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);

  const { data: filesData, isLoading: filesLoading, refetch: refetchFiles } = useQuery({
    queryKey: ['server-files', id, currentDir],
    queryFn: () => api.get(`/servers/${id}/files`, { params: { directory: currentDir } }).then((r) => r.data),
    enabled: activeTab === 'files' && !!id,
  });

  const openFile = async (filePath: string) => {
    try {
      const { data } = await api.get(`/servers/${id}/files/contents`, { params: { file: filePath } });
      setEditingFile({ path: filePath, content: data.content });
      setEditContent(data.content);
    } catch {
      toast.error('Cannot open file');
    }
  };

  const saveFile = async () => {
    if (!editingFile) return;
    setSavingFile(true);
    try {
      await api.post(`/servers/${id}/files/write`, { file: editingFile.path, content: editContent });
      toast.success('File saved');
      setEditingFile(null);
    } catch {
      toast.error('Failed to save file');
    } finally {
      setSavingFile(false);
    }
  };

  const deleteFile = async (filePath: string) => {
    try {
      await api.post(`/servers/${id}/files/delete`, { files: [filePath] });
      toast.success('Deleted');
      refetchFiles();
    } catch {
      toast.error('Failed to delete');
    }
  };

  const { data: backupsData } = useQuery({
    queryKey: ['server-backups', id],
    queryFn: () => api.get(`/servers/${id}/backups`).then((r) => r.data.data),
    enabled: activeTab === 'backups' && !!id,
  });

  useEffect(() => {
    if (data) setCurrentStatus(data.status);
  }, [data]);

  // Poll players every 15s when console tab is active
  useEffect(() => {
    if (activeTab !== 'console' || !id) return;
    const load = async () => {
      try {
        const { data: pd } = await api.get(`/servers/${id}/players`);
        const playerList: { name: string; uuid: string }[] = pd.players || [];
        setOnlinePlayers(playerList);
        setPlayers({ online: playerList.length, max: pd.max ?? 0, names: playerList.map((p) => p.name) });
      } catch { /* ignore */ }
    };
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [activeTab, id]);

  useEffect(() => {
    if (activeTab === 'plugins' && id) loadInstalledPlugins();
  }, [activeTab, id]);

  useEffect(() => {
    if (activeTab === 'versions' && id && versions.length === 0) loadVersions();
  }, [activeTab, id]);

  useEffect(() => {
    if (selectedVersion) loadBuilds(selectedVersion);
  }, [selectedVersion]);

  const searchPlugins = async () => {
    if (!pluginQuery.trim()) return;
    setPluginLoading(true);
    setPluginResults([]);
    try {
      const facets = encodeURIComponent(JSON.stringify([['project_type:plugin']]));
      const res = await fetch(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(pluginQuery)}&facets=${facets}&limit=20`);
      const json = await res.json();
      setPluginResults(json.hits ?? []);
    } catch {
      toast.error('Failed to search Modrinth');
    } finally {
      setPluginLoading(false);
    }
  };

  const loadInstalledPlugins = async () => {
    setPluginsLoading(true);
    try {
      const { data } = await api.get(`/servers/${id}/files`, { params: { directory: '/plugins' } });
      const jars = ((data.files as FileEntry[]) || []).filter((f) => f.isFile && f.name.endsWith('.jar'));
      setInstalledPlugins(jars);
    } catch {
      setInstalledPlugins([]);
    } finally {
      setPluginsLoading(false);
    }
  };

  const deletePlugin = async (filename: string) => {
    setDeletingPlugin(filename);
    try {
      await api.post(`/servers/${id}/files/delete`, { files: [`/plugins/${filename}`] });
      toast.success(`${filename} deleted`);
      setInstalledPlugins((prev) => prev.filter((p) => p.name !== filename));
    } catch {
      toast.error('Failed to delete plugin');
    } finally {
      setDeletingPlugin(null);
    }
  };

  const loadVersions = async () => {
    setVersionLoading(true);
    try {
      const { data } = await api.get(`/servers/${id}/versions`);
      setVersions(data.versions || []);
      if (data.versions?.length > 0) setSelectedVersion(data.versions[0]);
    } catch {
      toast.error('Failed to load versions');
    } finally {
      setVersionLoading(false);
    }
  };

  const loadBuilds = async (version: string) => {
    if (!version) return;
    try {
      const { data } = await api.get(`/servers/${id}/versions/${version}/builds`);
      setBuilds(data.builds || []);
      setSelectedBuild('latest');
    } catch {
      setBuilds([]);
    }
  };

  const installVersion = async () => {
    if (!selectedVersion) return;
    setInstallingVersion(true);
    try {
      const payload = { version: selectedVersion, build: selectedBuild === 'latest' ? undefined : selectedBuild };
      const { data: versionData } = await api.post(`/servers/${id}/version`, payload, { timeout: 180000 });
      // Persist the installed MC version so plugin installer can pick the right build
      await api.patch(`/servers/${id}`, { mcVersion: selectedVersion }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['server', id] });
      toast.success(versionData.message || 'Version installed! Restart the server to apply.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Version change failed';
      toast.error(msg);
    } finally {
      setInstallingVersion(false);
    }
  };

  const installPlugin = async (project: ModrinthProject) => {
    setInstalling(project.project_id);
    try {
      // Determine the server's MC version from its stored env (set when version is installed)
      let mcVersion: string | undefined;
      try {
        const env = JSON.parse((data as unknown as { env?: string })?.env || '{}') as Record<string, string>;
        mcVersion = env['MC_VERSION'];
      } catch { /* no env, proceed without version filter */ }

      const versRes = await fetch(`https://api.modrinth.com/v2/project/${project.project_id}/version`);
      if (!versRes.ok) { toast.error('Could not fetch version list'); return; }
      const allVersions: ModrinthVersion[] = await versRes.json();
      if (!allVersions || allVersions.length === 0) { toast.error('No versions found'); return; }

      const preferredLoaders = ['paper', 'purpur', 'folia', 'spigot', 'bukkit'];

      // Progressively relax version matching until we find something
      // 1. Exact match (e.g. "1.21.1")
      // 2. Minor-only match (e.g. "1.21.x")
      // 3. Any version (last resort)
      let candidates = allVersions;
      if (mcVersion) {
        const exactMatch = allVersions.filter((v) =>
          v.game_versions?.includes(mcVersion!)
        );
        if (exactMatch.length > 0) {
          candidates = exactMatch;
        } else {
          // Try matching major.minor (e.g. "1.21" matches "1.21", "1.21.1", "1.21.4")
          const majorMinor = mcVersion.split('.').slice(0, 2).join('.');
          const minorMatch = allVersions.filter((v) =>
            v.game_versions?.some((gv) => gv === majorMinor || gv.startsWith(majorMinor + '.'))
          );
          if (minorMatch.length > 0) {
            candidates = minorMatch;
          }
          // else fall back to all versions (plugin might not tag versions properly)
        }
      }

      // Among candidates, prefer Bukkit-compatible loaders
      const bestVersion =
        candidates.find((v) => v.loaders?.some((l) => preferredLoaders.includes(l.toLowerCase()))) ??
        candidates[0];

      if (!mcVersion) {
        // Warn if we couldn't determine server version
        toast('Tip: Install a Paper version first so plugins are downloaded for the correct MC version.', { icon: 'ℹ️' });
      } else if (!bestVersion.game_versions?.includes(mcVersion)) {
        toast(`No exact ${mcVersion} build found — installed closest compatible version.`, { icon: '⚠️' });
      }

      const primaryFile = bestVersion.files.find((f) => f.primary) ?? bestVersion.files[0];
      if (!primaryFile) { toast.error('No downloadable file found'); return; }

      await api.post(`/servers/${id}/plugins/install`, {
        url: primaryFile.url,
        filename: primaryFile.filename,
        type: 'plugins',
      });
      toast.success(`${project.title} installed!`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Installation failed';
      toast.error(msg);
    } finally {
      setInstalling(null);
    }
  };

  // Socket connection
  useEffect(() => {
    if (!id || !accessToken) return;

    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin;
    const socket = ioClient(socketUrl, {
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
      path: '/socket.io',
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('server:subscribe', id);
    });

    socket.on('server:status', (msg: { status?: ServerStatus; state?: string; serverId?: string }) => {
      const newStatus = (msg.status || (msg.state ? msg.state.toUpperCase() : undefined)) as ServerStatus | undefined;
      if (newStatus) {
        setCurrentStatus(newStatus);
        if (newStatus === 'OFFLINE' || newStatus === 'INSTALL_FAILED') {
          setStats(null);
        }
        queryClient.setQueryData(['server', id], (old: Server | undefined) =>
          old ? { ...old, status: newStatus } : old
        );
      }
    });

    socket.on('server:stats', (statsData: ServerStats) => {
      setStats(statsData);
    });

    socket.on('server:console:history', (lines: ConsoleLine[]) => {
      setConsoleLines(lines.map((l) => ({ ...l, historical: true } as ConsoleLine & { historical?: boolean })));
    });

    socket.on('server:console', (msg: { data: string; type?: ConsoleLine['type']; timestamp?: number }) => {
      setConsoleLines((prev) => [...prev.slice(-500), {
        type: msg.type ?? 'output',
        data: msg.data,
        timestamp: msg.timestamp ?? Date.now(),
      }]);
    });

    socket.on('server:players', (msg: { uuid: string; players: { name: string; uuid: string }[] }) => {
      if (msg.uuid === id) {
        setOnlinePlayers(msg.players);
        setPlayers({ online: msg.players.length, max: 0, names: msg.players.map((p) => p.name) });
      }
    });

    return () => {
      socket.emit('server:unsubscribe', id);
      socket.disconnect();
    };
  }, [id, accessToken, queryClient]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLines]);

  const openInventory = async (player: { name: string; uuid: string }) => {
    if (!player.uuid) return;
    setInventoryPlayer(player);
    setInventoryLoading(true);
    try {
      const { data } = await api.get(`/servers/${id}/players/${player.uuid}/inventory`);
      setPlayerInventory(data);
    } catch {
      setPlayerInventory(null);
    } finally {
      setInventoryLoading(false);
    }
  };

  const sendCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || !socketRef.current) return;
    socketRef.current.emit('server:command', { serverId: id, command: command.trim() });
    setCommand('');
  };

  const sendPower = (action: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit('server:power', { serverId: id, action });
    toast.success(`Server ${action} command sent`);
  };

  const createBackup = async () => {
    try {
      await api.post(`/servers/${id}/backups`, { name: `Backup ${new Date().toLocaleString()}` });
      toast.success('Backup started');
      queryClient.invalidateQueries({ queryKey: ['server-backups', id] });
    } catch {
      toast.error('Failed to create backup');
    }
  };

  if (isLoading) return (
    <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  );

  if (!data) return (
    <div className="text-center py-20 text-slate-400">Server not found</div>
  );

  const isRunning = currentStatus === 'RUNNING';
  const isOffline = currentStatus === 'OFFLINE' || currentStatus === 'INSTALL_FAILED';

  const cpuUsage = stats && !isNaN(stats.cpuAbsolute) ? Math.min(stats.cpuAbsolute, 100) : 0;
  const memUsage = stats && stats.memoryLimitBytes > 0
    ? Math.min((stats.memoryBytes / stats.memoryLimitBytes) * 100, 100)
    : 0;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link to="/servers" className="flex items-center gap-1 hover:text-slate-300 transition-colors">
          <ChevronLeft size={14} />
          Servers
        </Link>
        <span>/</span>
        <span className="text-slate-300">{data.name}</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={`h-3 w-3 rounded-full ${getServerStatusDot(currentStatus)}`} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100">{data.name}</h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs font-mono text-slate-500">{data.uuidShort}</span>
              <span className={`text-xs ${getServerStatusBadge(currentStatus)}`}>
                {currentStatus}
              </span>
              {data.allocation && (
                <span className="text-xs font-mono text-slate-400 bg-dark-800/60 px-1.5 py-0.5 rounded">
                  {(data.node as typeof data.node & { gameSubdomain?: string })?.gameSubdomain
                    ? `${data.uuidShort}.${(data.node as typeof data.node & { gameSubdomain?: string }).gameSubdomain}:${data.allocation.port}`
                    : `${data.allocation.ip}:${data.allocation.port}`}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Power controls */}
        <div className="flex items-center gap-2">
          <button
            className="btn-success btn-sm"
            onClick={() => sendPower('start')}
            disabled={!isOffline}
            title="Start"
          >
            <Play size={14} /> Start
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => sendPower('restart')}
            disabled={isOffline}
            title="Restart"
          >
            <RotateCcw size={14} /> Restart
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => sendPower('stop')}
            disabled={isOffline}
            title="Stop"
          >
            <Square size={14} /> Stop
          </button>
          <button
            className="btn-danger btn-sm"
            onClick={() => sendPower('kill')}
            disabled={isOffline}
            title="Kill"
          >
            <Zap size={14} /> Kill
          </button>
        </div>
      </div>

      {/* Resource overview */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniStat
            icon={<Cpu size={14} />}
            label="CPU"
            value={`${cpuUsage.toFixed(1)}%`}
            percent={cpuUsage}
            color="panel"
          />
          <MiniStat
            icon={<MemoryStick size={14} />}
            label="Memory"
            value={`${formatBytes(stats.memoryBytes)} / ${formatBytes(stats.memoryLimitBytes)}`}
            percent={memUsage}
            color="blue"
          />
          <MiniStat
            icon={<HardDrive size={14} />}
            label="Disk"
            value={formatBytes(stats.diskBytes)}
            percent={(stats.diskBytes / (data.disk * 1048576)) * 100}
            color="green"
          />
          <MiniStat
            icon={<BarChart2 size={14} />}
            label="Uptime"
            value={formatUptime(stats.uptime)}
            percent={100}
            color="orange"
            noBar
          />
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-dark-800">
        <div className="flex gap-1">
          {(['console', 'files', 'plugins', 'versions', 'stats', 'backups'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium capitalize border-b-2 transition-colors',
                activeTab === tab
                  ? 'border-panel-500 text-panel-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              )}
            >
              {tab === 'console' && <Terminal size={14} className="inline mr-1.5" />}
              {tab === 'files' && <Folder size={14} className="inline mr-1.5" />}
              {tab === 'plugins' && <Package size={14} className="inline mr-1.5" />}
              {tab === 'versions' && <Tag size={14} className="inline mr-1.5" />}
              {tab === 'stats' && <BarChart2 size={14} className="inline mr-1.5" />}
              {tab === 'backups' && <Archive size={14} className="inline mr-1.5" />}
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Console Tab */}
      {activeTab === 'console' && (
        <div className="flex gap-4">
          <div className="card flex-1 min-w-0">
            <div
              className="rounded-t-xl p-4 h-96 overflow-y-auto font-mono text-xs scrollbar-none"
              style={{ background: '#0b0f14' }}
            >
              {consoleLines.length === 0 ? (
                <p className="text-slate-600 italic">Waiting for output...</p>
              ) : (
                consoleLines.map((line, i) => {
                  const text = (line.data || '').replace(/\x1b\[[0-9;]*[mGKHF]/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
                  const isError = /\b(error|exception|fatal|severe)\b/i.test(text);
                  const isWarn = /\b(warn|warning)\b/i.test(text);
                  return (
                    <p
                      key={i}
                      className={cn(
                        'leading-relaxed whitespace-pre-wrap break-all',
                        line.type === 'input'
                          ? 'text-yellow-300/90'
                          : isError
                            ? 'text-red-400/90'
                            : isWarn
                              ? 'text-yellow-400/80'
                              : 'text-emerald-300/80'
                      )}
                    >
                      {text}
                    </p>
                  );
                })
              )}
              <div ref={consoleEndRef} />
            </div>
            <form onSubmit={sendCommand} className="flex gap-2 p-3 border-t border-dark-800">
              <span className="flex items-center text-green-400 font-mono text-sm px-2">$</span>
              <input
                type="text"
                className="input flex-1 font-mono text-sm"
                placeholder="Enter command..."
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                disabled={!isRunning}
              />
              <button type="submit" className="btn-primary btn-sm" disabled={!isRunning || !command.trim()}>
                Send
              </button>
            </form>
          </div>

          {/* Players widget */}
          <div className="card w-52 shrink-0 self-start">
            <div className="card-header flex items-center gap-2">
              <Users size={13} className="text-slate-400" />
              <span className="text-xs font-semibold text-slate-200">
                Players ({onlinePlayers.length})
              </span>
            </div>
            <div className="p-3 space-y-1.5 max-h-80 overflow-y-auto">
              {!isRunning ? (
                <p className="text-xs text-slate-600">Server offline</p>
              ) : onlinePlayers.length === 0 ? (
                <p className="text-xs text-slate-600">No players online</p>
              ) : (
                onlinePlayers.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => openInventory(p)}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg bg-dark-700 hover:bg-dark-600 border border-dark-600 hover:border-panel-500/40 transition-all group"
                    title="Click to view inventory"
                  >
                    <img
                      src={`https://mc-heads.net/avatar/${p.name}/24`}
                      alt={p.name}
                      className="w-6 h-6 rounded pixelated"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <span className="text-xs font-medium text-slate-300 group-hover:text-slate-100 flex-1 text-left truncate">{p.name}</span>
                    <Package size={10} className="text-slate-600 group-hover:text-panel-400 shrink-0" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Files Tab */}
      {activeTab === 'files' && (
        <div className="card">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 px-4 py-3 border-b border-dark-800 text-xs font-mono text-slate-400 flex-wrap">
            <button onClick={() => setCurrentDir('/')} className="hover:text-slate-200">/</button>
            {currentDir.split('/').filter(Boolean).map((part, i, arr) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight size={10} />
                <button
                  onClick={() => setCurrentDir('/' + arr.slice(0, i + 1).join('/'))}
                  className="hover:text-slate-200"
                >{part}</button>
              </span>
            ))}
            {currentDir !== '/' && (
              <button
                className="ml-auto flex items-center gap-1 text-slate-500 hover:text-slate-300"
                onClick={() => setCurrentDir(currentDir.split('/').slice(0, -1).join('/') || '/')}
              >
                <ArrowLeft size={12} /> Up
              </button>
            )}
          </div>

          {/* File editor overlay */}
          {editingFile && (
            <div className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-slate-400">{editingFile.path}</span>
                <div className="flex gap-2">
                  <button className="btn-secondary btn-sm" onClick={() => setEditingFile(null)}><X size={13} /> Cancel</button>
                  <button className="btn-primary btn-sm" onClick={saveFile} disabled={savingFile}>
                    {savingFile ? 'Saving...' : <><Check size={13} /> Save</>}
                  </button>
                </div>
              </div>
              <textarea
                className="w-full h-96 bg-dark-950 border border-slate-700/50 rounded-lg p-3 font-mono text-xs text-slate-300 resize-y focus:outline-none focus:border-brand-500/50"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                spellCheck={false}
              />
            </div>
          )}

          {/* File list */}
          {!editingFile && (
            filesLoading ? (
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : (
              <div className="divide-y divide-dark-800/50">
                {(!filesData?.files || filesData.files.length === 0) && (
                  <div className="p-10 text-center text-slate-500 text-sm">Empty directory</div>
                )}
                {(filesData?.files as FileEntry[] || []).sort((a, b) =>
                  a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
                ).map((file) => (
                  <div key={file.name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-dark-800/30 group">
                    <div className="text-slate-500 shrink-0">
                      {file.isDir
                        ? <FolderOpen size={16} className="text-yellow-400/70" />
                        : <File size={16} className="text-slate-500" />}
                    </div>
                    <button
                      className="flex-1 text-left text-sm text-slate-300 hover:text-slate-100 truncate"
                      onClick={() => {
                        if (file.isDir) {
                          setCurrentDir(currentDir.replace(/\/$/, '') + '/' + file.name);
                        } else {
                          openFile((currentDir.replace(/\/$/, '') + '/' + file.name));
                        }
                      }}
                    >
                      {file.name}
                    </button>
                    <span className="text-xs text-slate-600 shrink-0 hidden group-hover:inline">
                      {file.isFile ? formatBytes(file.size) : ''}
                    </span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {file.isFile && (
                        <button
                          className="p-1 text-slate-500 hover:text-slate-300"
                          onClick={() => openFile((currentDir.replace(/\/$/, '') + '/' + file.name))}
                          title="Edit"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      <button
                        className="p-1 text-slate-500 hover:text-red-400"
                        onClick={() => deleteFile((currentDir.replace(/\/$/, '') + '/' + file.name))}
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Toolbar */}
          {!editingFile && (
            <div className="flex gap-2 px-4 py-3 border-t border-dark-800">
              <button
                className="btn-secondary btn-sm"
                onClick={async () => {
                  const name = prompt('Folder name:');
                  if (!name) return;
                  try {
                    await api.post(`/servers/${id}/files/create-folder`, { name, directory: currentDir });
                    refetchFiles();
                  } catch { toast.error('Failed to create folder'); }
                }}
              >
                <Plus size={13} /> New Folder
              </button>
            </div>
          )}
        </div>
      )}

      {/* Plugins Tab */}
      {activeTab === 'plugins' && (
        <div className="space-y-4">
          {/* Installed plugins */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Installed Plugins</h3>
                <p className="text-xs text-slate-500 mt-0.5">{installedPlugins.length} plugin(s) in /plugins</p>
              </div>
              <button className="btn-secondary btn-sm" onClick={loadInstalledPlugins}>
                <RefreshCw size={13} /> Refresh
              </button>
            </div>
            <div className="divide-y divide-dark-800/50">
              {pluginsLoading ? (
                <div className="flex justify-center py-6"><Spinner /></div>
              ) : installedPlugins.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  <Package size={28} className="mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No plugins installed</p>
                </div>
              ) : (
                installedPlugins.map((plugin) => (
                  <div key={plugin.name} className="flex items-center gap-3 px-4 py-3">
                    <Package size={15} className="text-slate-500 shrink-0" />
                    <span className="flex-1 text-sm text-slate-300 font-mono truncate">{plugin.name}</span>
                    <span className="text-xs text-slate-600">{formatBytes(plugin.size)}</span>
                    <button
                      className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"
                      onClick={() => deletePlugin(plugin.name)}
                      disabled={deletingPlugin === plugin.name}
                      title="Delete"
                    >
                      {deletingPlugin === plugin.name ? <Spinner size="sm" /> : <Trash2 size={13} />}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Modrinth search */}
          <div className="card">
            <div className="card-header">
              <h3 className="text-sm font-semibold text-slate-100">Install from Modrinth</h3>
              <p className="text-xs text-slate-500 mt-0.5">Search and install plugins directly to your server</p>
            </div>
            <div className="p-4 border-b border-dark-800">
              <form
                onSubmit={(e) => { e.preventDefault(); searchPlugins(); }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  className="input flex-1"
                  placeholder="Search plugins (e.g. WorldEdit, EssentialsX)..."
                  value={pluginQuery}
                  onChange={(e) => setPluginQuery(e.target.value)}
                />
                <button type="submit" className="btn-primary btn-sm" disabled={pluginLoading || !pluginQuery.trim()}>
                  {pluginLoading ? <Spinner size="sm" /> : <><Search size={14} /> Search</>}
                </button>
              </form>
            </div>
            <div className="divide-y divide-dark-800/50">
              {pluginResults.length === 0 && !pluginLoading && (
                <div className="p-8 text-center text-slate-500">
                  <Package size={32} className="mx-auto mb-3 opacity-20" />
                  <p className="text-sm">Search for plugins to install</p>
                </div>
              )}
              {pluginResults.map((project) => (
                <div key={project.project_id} className="flex items-start gap-4 px-5 py-4">
                  {project.icon_url ? (
                    <img src={project.icon_url} alt="" className="w-10 h-10 rounded-lg shrink-0 object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-dark-800 flex items-center justify-center shrink-0">
                      <Package size={18} className="text-slate-500" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-200">{project.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{project.description}</p>
                    <p className="text-xs text-slate-600 mt-1">{project.downloads.toLocaleString()} downloads</p>
                  </div>
                  <button
                    className="btn-primary btn-sm shrink-0"
                    disabled={installing === project.project_id}
                    onClick={() => installPlugin(project)}
                  >
                    {installing === project.project_id ? <Spinner size="sm" /> : <><Download size={13} /> Install</>}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Versions Tab */}
      {activeTab === 'versions' && (
        <div className="card card-body space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-100 mb-1">Paper Version Manager</h3>
            <p className="text-xs text-slate-500">Download and install a specific Paper version. Stop the server before changing versions.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Minecraft Version</label>
              {versionLoading ? (
                <div className="flex items-center gap-2 text-slate-500 text-sm"><Spinner size="sm" /> Loading versions...</div>
              ) : (
                <select
                  className="input w-full"
                  value={selectedVersion}
                  onChange={(e) => setSelectedVersion(e.target.value)}
                >
                  {versions.length === 0 && <option value="">No versions available</option>}
                  {versions.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Build</label>
              <select
                className="input w-full"
                value={selectedBuild === 'latest' ? 'latest' : String(selectedBuild)}
                onChange={(e) => setSelectedBuild(e.target.value === 'latest' ? 'latest' : parseInt(e.target.value))}
              >
                <option value="latest">Latest</option>
                {builds.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>

            <div className="flex items-end">
              <button
                className="btn-primary w-full"
                disabled={!selectedVersion || installing_version || currentStatus !== 'OFFLINE'}
                onClick={installVersion}
              >
                {installing_version ? (
                  <><Spinner size="sm" /> Downloading...</>
                ) : (
                  <><Download size={14} /> Install Version</>
                )}
              </button>
            </div>
          </div>

          {currentStatus !== 'OFFLINE' && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs">
              <Square size={13} />
              Stop the server before changing versions.
            </div>
          )}

          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span><strong>Downgrade uyarısı:</strong> Dünyayı daha yeni bir sürümde açtıysanız eski sürüme geçmek chunk verilerini bozar ve sunucu çöker. Sürüm değiştirmeden önce mutlaka yedek alın. Yukarı sürüm geçişi (upgrade) güvenlidir.</span>
          </div>

          <div className="flex items-center gap-2 p-3 rounded-lg bg-dark-800/60 text-slate-500 text-xs">
            <Tag size={13} />
            After installing, start the server — Paper will automatically remap and launch with the new version.
          </div>
        </div>
      )}

      {/* Stats Tab */}
      {activeTab === 'stats' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card card-body">
            <h3 className="text-sm font-semibold text-slate-300 mb-4">Server Information</h3>
            <dl className="space-y-3">
              <InfoRow label="Node" value={data.node?.name || '-'} />
              <InfoRow label="Egg" value={data.egg?.name || '-'} />
              <InfoRow label="Docker Image" value={data.image} mono />
              <InfoRow
                label="Connection"
                value={data.allocation
                  ? ((data.node as typeof data.node & { gameSubdomain?: string })?.gameSubdomain
                      ? `${data.uuidShort}.${(data.node as typeof data.node & { gameSubdomain?: string }).gameSubdomain}:${data.allocation.port}`
                      : `${data.allocation.ip}:${data.allocation.port}`)
                  : '-'}
                mono
              />
              <InfoRow label="UUID" value={data.uuid} mono small />
            </dl>
          </div>
          <div className="card card-body">
            <h3 className="text-sm font-semibold text-slate-300 mb-4">Resource Limits</h3>
            <dl className="space-y-3">
              <InfoRow label="Memory" value={`${data.memory} MB`} />
              <InfoRow label="Swap" value={`${data.swap} MB`} />
              <InfoRow label="Disk" value={`${data.disk} MB`} />
              <InfoRow label="CPU Limit" value={data.cpu > 0 ? `${data.cpu}%` : 'Unlimited'} />
              <InfoRow label="Backup Limit" value={String(data.backupLimit)} />
            </dl>
          </div>
        </div>
      )}

      {/* Backups Tab */}
      {activeTab === 'backups' && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100">Backups</h3>
            <button className="btn-primary btn-sm" onClick={createBackup}>
              <Archive size={14} /> Create Backup
            </button>
          </div>
          <div className="divide-y divide-dark-800">
            {!backupsData || backupsData.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                <Archive size={32} className="mx-auto mb-2 opacity-20" />
                <p>No backups yet</p>
              </div>
            ) : (
              backupsData.map((backup: { id: string; name: string; isSuccessful: boolean; bytes: number; createdAt: string }) => (
                <div key={backup.id} className="px-6 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-200">{backup.name}</p>
                    <p className="text-xs text-slate-500">
                      {formatBytes(backup.bytes)} · {new Date(backup.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span className={backup.isSuccessful ? 'badge-green' : 'badge-yellow'}>
                    {backup.isSuccessful ? 'Complete' : 'Pending'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Inventory Modal */}
      {inventoryPlayer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setInventoryPlayer(null); setPlayerInventory(null); }}>
          <div className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-2xl mx-4 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-5">
              <img src={`https://mc-heads.net/avatar/${inventoryPlayer.name}/40`} alt="" className="w-10 h-10 rounded pixelated" />
              <div>
                <h3 className="text-slate-100 font-semibold">{inventoryPlayer.name}</h3>
                <p className="text-xs text-slate-500 font-mono">{inventoryPlayer.uuid}</p>
              </div>
              <button className="ml-auto text-slate-500 hover:text-slate-300" onClick={() => { setInventoryPlayer(null); setPlayerInventory(null); }}><X size={18} /></button>
            </div>

            {inventoryLoading ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : !playerInventory ? (
              <p className="text-slate-500 text-sm text-center py-8">Could not read inventory. Player must be offline or data unavailable.</p>
            ) : (
              <div className="space-y-4">
                <InventoryGrid title="Inventory" items={playerInventory.inventory} />
                <InventoryGrid title="Ender Chest" items={playerInventory.enderChest} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InventoryGrid({ title, items }: { title: string; items: NbtItem[] }) {
  if (items.length === 0) return (
    <div>
      <p className="text-xs font-semibold text-slate-400 mb-2">{title}</p>
      <p className="text-xs text-slate-600">Empty</p>
    </div>
  );
  return (
    <div>
      <p className="text-xs font-semibold text-slate-400 mb-2">{title} ({items.length} items)</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <div key={i} className="relative group">
            <div
              className="w-10 h-10 bg-dark-700 border border-dark-600 rounded flex flex-col items-center justify-center hover:border-panel-500/40 transition-colors cursor-default"
              title={`${item.id} ×${item.count} (slot ${item.slot})`}
            >
              <span className="text-[8px] text-slate-400 leading-tight text-center px-0.5 truncate w-full">{item.id.replace(/_/g, ' ')}</span>
              {item.count > 1 && <span className="text-[9px] font-bold text-yellow-400 leading-none">{item.count}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value, percent, color, noBar }: {
  icon: React.ReactNode; label: string; value: string;
  percent: number; color: string; noBar?: boolean;
}) {
  const colorMap: Record<string, string> = {
    panel: 'bg-panel-500', blue: 'bg-blue-500', green: 'bg-green-500', orange: 'bg-orange-500',
  };

  return (
    <div className="card p-3">
      <div className="flex items-center gap-1.5 text-slate-400 mb-1">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-sm font-semibold text-slate-100 mb-1.5">{value}</p>
      {!noBar && (
        <div className="progress-bar">
          <div
            className={cn('progress-fill', colorMap[color] || 'bg-panel-500')}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value, mono, small }: {
  label: string; value: string; mono?: boolean; small?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-xs text-slate-500 font-medium shrink-0">{label}</dt>
      <dd className={cn(
        'text-right break-all',
        mono ? 'font-mono' : '',
        small ? 'text-xs text-slate-500' : 'text-sm text-slate-300'
      )}>
        {value}
      </dd>
    </div>
  );
}
