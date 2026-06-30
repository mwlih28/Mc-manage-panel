import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Play, Square, RotateCcw, Zap, Terminal, BarChart2,
  HardDrive, Archive, ChevronLeft, Cpu, MemoryStick,
  Folder, FolderOpen, File, ChevronRight, ArrowLeft, Pencil, Trash2, Plus, X, Check,
  Package, Users, Search, Download, RefreshCw, Tag, AlertTriangle, Shield, ShieldOff,
  MapPin, Clock, Sword, Hammer, Footprints, Ban, LogOut, Wifi, Navigation,
  StickyNote, CalendarClock, UserCog, Save
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

type Tab = 'console' | 'files' | 'plugins' | 'versions' | 'stats' | 'backups' | 'players' | 'notes' | 'schedule' | 'access';

// ── Schedule types ─────────────────────────────────────────────────────────────
interface ScheduledTask {
  id: string;
  name: string;
  action: 'command' | 'power' | 'backup';
  payload?: string;
  cronExpression: string;
  enabled: boolean;
  nextRunAt?: string;
}

// ── Access / Sub-user types ────────────────────────────────────────────────────
interface SubUser {
  id: string;
  email: string;
  username?: string;
  permissions: string[];
}

// ── Stats history types ────────────────────────────────────────────────────────
interface StatsHistoryPoint {
  cpuAbsolute: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  diskBytes: number;
  timestamp: string | number;
}

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

interface PlayerHistoryEntry {
  name: string;
  uuid: string;
  firstSeen: string;
  lastSeen: string;
  joinCount: number;
  online: boolean;
}

interface PlayerDetails {
  stats: {
    playTimeTicks: number; deaths: number; walkOneCm: number; sprintOneCm: number;
    jumps: number; playerKills: number; mobKills: number; blocksMinedTotal: number;
  };
  location: { x: number; y: number; z: number; dimension: string; health: number; xpLevel: number } | null;
  inventory: NbtItem[];
  enderChest: NbtItem[];
  ban: { banned: boolean; reason: string; expires: string; bannedBy: string } | null;
}

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

  // Players (console widget)
  const [players, setPlayers] = useState<{ online: number; max: number; names: string[] }>({ online: 0, max: 0, names: [] });
  const [onlinePlayers, setOnlinePlayers] = useState<{ name: string; uuid: string }[]>([]);
  const [inventoryPlayer, setInventoryPlayer] = useState<{ name: string; uuid: string } | null>(null);
  const [playerInventory, setPlayerInventory] = useState<{ inventory: NbtItem[]; enderChest: NbtItem[] } | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);

  // Players tab
  const [playerSearch, setPlayerSearch] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerHistoryEntry | null>(null);
  const [playerDetails, setPlayerDetails] = useState<PlayerDetails | null>(null);
  const [playerDetailsLoading, setPlayerDetailsLoading] = useState(false);
  const [banReason, setBanReason] = useState('');
  const [kickReason, setKickReason] = useState('');
  const [playerActionLoading, setPlayerActionLoading] = useState<string | null>(null);
  const [tpAdminName, setTpAdminName] = useState(() => localStorage.getItem('mcAdminName') || '');

  // ── Notes tab state ──────────────────────────────────────────────────────────
  const [notesContent, setNotesContent] = useState('');
  const [notesSavedAt, setNotesSavedAt] = useState<Date | null>(null);
  const [notesSaving, setNotesSaving] = useState(false);
  const notesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Schedule tab state ───────────────────────────────────────────────────────
  const [schedules, setSchedules] = useState<ScheduledTask[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    name: '',
    action: 'command' as 'command' | 'power' | 'backup',
    command: '',
    powerAction: 'restart' as 'start' | 'stop' | 'restart' | 'kill',
    cronExpression: '',
    enabled: true,
  });
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [deletingSchedule, setDeletingSchedule] = useState<string | null>(null);

  // ── Access tab state ─────────────────────────────────────────────────────────
  const [subUsers, setSubUsers] = useState<SubUser[]>([]);
  const [subUsersLoading, setSubUsersLoading] = useState(false);
  const [accessEmail, setAccessEmail] = useState('');
  const [accessPerms, setAccessPerms] = useState({
    console: false, files: false, power: false, players: false, backups: false,
  });
  const [addingAccess, setAddingAccess] = useState(false);
  const [removingAccess, setRemovingAccess] = useState<string | null>(null);

  const { data: filesData, isLoading: filesLoading, refetch: refetchFiles } = useQuery({
    queryKey: ['server-files', id, currentDir],
    queryFn: () => api.get(`/servers/${id}/files`, { params: { directory: currentDir } }).then((r) => r.data),
    enabled: activeTab === 'files' && !!id,
  });

  const { data: allPlayersData, isLoading: allPlayersLoading, refetch: refetchAllPlayers } = useQuery({
    queryKey: ['server-players-all', id],
    queryFn: () => api.get(`/servers/${id}/players/all`).then((r) => r.data),
    enabled: activeTab === 'players' && !!id,
    refetchInterval: activeTab === 'players' ? 30000 : false,
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

  // Notes: load when tab activates
  const { data: notesData } = useQuery({
    queryKey: ['server-notes', id],
    queryFn: () => api.get(`/servers/${id}/notes`).then((r) => r.data),
    enabled: activeTab === 'notes' && !!id,
  });

  useEffect(() => {
    if (notesData) {
      setNotesContent(notesData.content ?? notesData.notes ?? '');
    }
  }, [notesData]);

  // Stats history
  const { data: statsHistory } = useQuery({
    queryKey: ['server-stats-history', id],
    queryFn: () => api.get(`/servers/${id}/stats/history`).then((r) => r.data),
    enabled: activeTab === 'stats' && !!id,
    refetchInterval: activeTab === 'stats' ? 10000 : false,
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
      toast.error('Failed to search plugins');
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

  const openPlayerDetail = async (player: PlayerHistoryEntry) => {
    if (!player.uuid) { setSelectedPlayer(player); setPlayerDetails(null); return; }
    setSelectedPlayer(player);
    setPlayerDetailsLoading(true);
    setBanReason(''); setKickReason('');
    try {
      const { data } = await api.get(`/servers/${id}/players/${player.uuid}/details`);
      setPlayerDetails(data);
    } catch { setPlayerDetails(null); }
    finally { setPlayerDetailsLoading(false); }
  };

  const playerAction = async (action: 'ban' | 'unban' | 'kick' | 'ipban' | 'tp', player: PlayerHistoryEntry) => {
    if (!player.uuid && action !== 'kick' && action !== 'tp') { toast.error('Player UUID unknown'); return; }
    setPlayerActionLoading(action);
    try {
      if (action === 'ban') {
        await api.post(`/servers/${id}/players/${player.uuid}/ban`, { reason: banReason || 'Banned by admin', name: player.name });
        toast.success(`${player.name} banned`);
      } else if (action === 'unban') {
        await api.delete(`/servers/${id}/players/${player.uuid}/ban`, { params: { name: player.name } });
        toast.success(`${player.name} unbanned`);
      } else if (action === 'kick') {
        await api.post(`/servers/${id}/players/${player.uuid}/kick`, { name: player.name, reason: kickReason || 'Kicked by admin' });
        toast.success(`${player.name} kicked`);
      } else if (action === 'ipban') {
        await api.post(`/servers/${id}/players/${player.uuid}/ipban`, { name: player.name, reason: banReason || 'IP banned by admin' });
        toast.success(`${player.name} IP banned`);
      } else if (action === 'tp') {
        if (!tpAdminName.trim()) { toast.error('Enter your in-game name first'); return; }
        await api.post(`/servers/${id}/command`, { command: `tp ${tpAdminName.trim()} ${player.name}` });
        toast.success(`Teleporting ${tpAdminName} → ${player.name}`);
      }
      // Refresh details
      if (player.uuid) {
        const { data } = await api.get(`/servers/${id}/players/${player.uuid}/details`);
        setPlayerDetails(data);
      }
      refetchAllPlayers();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? `${action} failed`;
      toast.error(msg);
    } finally { setPlayerActionLoading(null); }
  };

  const deleteInventoryItem = async (player: PlayerHistoryEntry, slot: number, fromEnder = false) => {
    if (!player.uuid) return;
    try {
      await api.delete(`/servers/${id}/players/${player.uuid}/inventory/${slot}`, { params: fromEnder ? { from: 'ender' } : {} });
      toast.success('Item removed');
      const { data } = await api.get(`/servers/${id}/players/${player.uuid}/details`);
      setPlayerDetails(data);
    } catch { toast.error('Failed to remove item'); }
  };

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

  // ── Notes handlers ────────────────────────────────────────────────────────────
  const saveNotes = useCallback(async (content: string) => {
    setNotesSaving(true);
    try {
      await api.put(`/servers/${id}/notes`, { content });
      setNotesSavedAt(new Date());
    } catch {
      toast.error('Failed to save notes');
    } finally {
      setNotesSaving(false);
    }
  }, [id]);

  const handleNotesChange = (val: string) => {
    setNotesContent(val);
    if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current);
    notesDebounceRef.current = setTimeout(() => saveNotes(val), 1500);
  };

  // ── Schedule handlers ─────────────────────────────────────────────────────────
  const loadSchedules = async () => {
    setSchedulesLoading(true);
    try {
      const { data: sd } = await api.get(`/servers/${id}/schedules`);
      setSchedules(sd.data ?? sd ?? []);
    } catch {
      setSchedules([]);
    } finally {
      setSchedulesLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'schedule' && id) loadSchedules();
  }, [activeTab, id]);

  const createSchedule = async () => {
    setSavingSchedule(true);
    try {
      const payload: Record<string, unknown> = {
        name: scheduleForm.name,
        action: scheduleForm.action,
        cronExpression: scheduleForm.cronExpression,
        enabled: scheduleForm.enabled,
      };
      if (scheduleForm.action === 'command') payload.payload = scheduleForm.command;
      if (scheduleForm.action === 'power') payload.payload = scheduleForm.powerAction;
      await api.post(`/servers/${id}/schedules`, payload);
      toast.success('Schedule created');
      setShowScheduleModal(false);
      setScheduleForm({ name: '', action: 'command', command: '', powerAction: 'restart', cronExpression: '', enabled: true });
      loadSchedules();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to create schedule';
      toast.error(msg);
    } finally {
      setSavingSchedule(false);
    }
  };

  const deleteSchedule = async (scheduleId: string) => {
    setDeletingSchedule(scheduleId);
    try {
      await api.delete(`/servers/${id}/schedules/${scheduleId}`);
      toast.success('Schedule deleted');
      setSchedules(prev => prev.filter(s => s.id !== scheduleId));
    } catch {
      toast.error('Failed to delete schedule');
    } finally {
      setDeletingSchedule(null);
    }
  };

  // ── Access handlers ───────────────────────────────────────────────────────────
  const loadSubUsers = async () => {
    setSubUsersLoading(true);
    try {
      const { data: su } = await api.get(`/servers/${id}/subusers`);
      setSubUsers(su.data ?? su ?? []);
    } catch {
      setSubUsers([]);
    } finally {
      setSubUsersLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'access' && id) loadSubUsers();
  }, [activeTab, id]);

  const addSubUser = async () => {
    if (!accessEmail.trim()) return;
    setAddingAccess(true);
    try {
      const perms = Object.entries(accessPerms)
        .filter(([, v]) => v)
        .map(([k]) => k);
      await api.post(`/servers/${id}/subusers`, { email: accessEmail.trim(), permissions: perms });
      toast.success('Access granted');
      setAccessEmail('');
      setAccessPerms({ console: false, files: false, power: false, players: false, backups: false });
      loadSubUsers();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to add user';
      toast.error(msg);
    } finally {
      setAddingAccess(false);
    }
  };

  const removeSubUser = async (userId: string) => {
    setRemovingAccess(userId);
    try {
      await api.delete(`/servers/${id}/subusers/${userId}`);
      toast.success('Access removed');
      setSubUsers(prev => prev.filter(u => u.id !== userId));
    } catch {
      toast.error('Failed to remove access');
    } finally {
      setRemovingAccess(null);
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

  const isBedrock = (() => {
    try {
      const env = typeof (data as unknown as { env?: string })?.env === 'string'
        ? JSON.parse((data as unknown as { env?: string }).env!)
        : {};
      if (env.SERVER_TYPE === 'BEDROCK') return true;
    } catch { /* ignore */ }
    return data?.egg?.name?.toLowerCase().includes('bedrock') ?? false;
  })();

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
              {isBedrock && (
                <span className="badge badge-blue text-[10px] uppercase tracking-wide">Bedrock</span>
              )}
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
      <div className="border-b border-dark-800 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {(['console', 'files', 'plugins', 'versions', 'stats', 'backups', 'players', 'notes', 'schedule', 'access'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium capitalize border-b-2 transition-colors whitespace-nowrap',
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
              {tab === 'players' && <Users size={14} className="inline mr-1.5" />}
              {tab === 'notes' && <StickyNote size={14} className="inline mr-1.5" />}
              {tab === 'schedule' && <CalendarClock size={14} className="inline mr-1.5" />}
              {tab === 'access' && <UserCog size={14} className="inline mr-1.5" />}
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
                    onClick={() => !isBedrock && openInventory(p)}
                    className={cn(
                      'flex items-center gap-2 w-full px-2 py-1.5 rounded-lg bg-dark-700 border border-dark-600 transition-all group',
                      isBedrock ? 'cursor-default' : 'hover:bg-dark-600 hover:border-panel-500/40'
                    )}
                    title={isBedrock ? p.name : 'Click to view inventory'}
                  >
                    <img
                      src={`https://mc-heads.net/avatar/${p.name}/24`}
                      alt={p.name}
                      className="w-6 h-6 rounded pixelated"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <span className="text-xs font-medium text-slate-300 group-hover:text-slate-100 flex-1 text-left truncate">{p.name}</span>
                    {!isBedrock && <Package size={10} className="text-slate-600 group-hover:text-panel-400 shrink-0" />}
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

          {/* Plugin search */}
          <div className="card">
            <div className="card-header">
              <h3 className="text-sm font-semibold text-slate-100">Plugin Marketplace</h3>
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
        <div className="space-y-4">
          {/* Resource Sparklines */}
          <div className="card card-body">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Resource Usage (last 2 minutes)</h3>
            <StatsSparklines history={(statsHistory?.data ?? []) as StatsHistoryPoint[]} />
            <div className="flex gap-4 mt-3 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-green-400 rounded" /> CPU %</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-blue-400 rounded" /> RAM %</span>
            </div>
          </div>
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

      {/* Players Tab */}
      {activeTab === 'players' && (() => {
        const allPlayers: PlayerHistoryEntry[] = allPlayersData?.players ?? [];
        const filteredPlayers = allPlayers.filter(p =>
          !playerSearch || p.name.toLowerCase().includes(playerSearch.toLowerCase())
        );
        const isAdmin = data?.user === undefined || true; // server owner or admin can see
        return (
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input className="input pl-9" placeholder="Search players..." value={playerSearch} onChange={e => setPlayerSearch(e.target.value)} />
              </div>
              <button className="btn-secondary btn-sm" onClick={() => refetchAllPlayers()}>
                <RefreshCw size={14} /> Refresh
              </button>
            </div>

            <div className="card">
              {allPlayersLoading ? (
                <div className="flex justify-center py-12"><Spinner /></div>
              ) : (
                <div className="table-container">
                  <table className="table">
                    <thead><tr>
                      <th>Player</th><th>Status</th><th>Last Seen</th><th>Joins</th><th></th>
                    </tr></thead>
                    <tbody>
                      {filteredPlayers.length === 0 ? (
                        <tr><td colSpan={5} className="text-center py-10 text-slate-500">
                          {allPlayers.length === 0 ? 'No players have joined yet' : 'No players match your search'}
                        </td></tr>
                      ) : filteredPlayers.map(player => (
                        <tr key={player.name} className="cursor-pointer hover:bg-dark-800/40" onClick={() => openPlayerDetail(player)}>
                          <td>
                            <div className="flex items-center gap-2.5">
                              <img src={`https://mc-heads.net/avatar/${player.name}/32`} alt="" className="w-8 h-8 rounded pixelated shrink-0" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                              <div>
                                <p className="font-medium text-slate-200">{player.name}</p>
                                <p className="text-xs font-mono text-slate-600 truncate max-w-[160px]">{player.uuid || '—'}</p>
                              </div>
                            </div>
                          </td>
                          <td>
                            {player.online
                              ? <span className="badge-green flex items-center gap-1 w-fit"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />Online</span>
                              : <span className="text-xs text-slate-500">Offline</span>
                            }
                          </td>
                          <td className="text-xs text-slate-400">
                            {player.lastSeen && new Date(player.lastSeen).getTime() > 0
                              ? new Date(player.lastSeen).toLocaleString()
                              : '—'}
                          </td>
                          <td className="text-slate-400 text-sm">{player.joinCount || '—'}</td>
                          <td onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              {player.online && (
                                <button
                                  className="p-1.5 text-slate-500 hover:text-yellow-400 hover:bg-yellow-500/10 rounded transition-colors"
                                  title="Kick"
                                  onClick={async () => {
                                    const reason = prompt(`Kick reason for ${player.name}:`, 'Kicked by admin');
                                    if (reason === null) return;
                                    setKickReason(reason);
                                    await playerAction('kick', { ...player, name: player.name });
                                  }}
                                ><LogOut size={13} /></button>
                              )}
                              <button
                                className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                title="View / Ban"
                                onClick={() => openPlayerDetail(player)}
                              ><Shield size={13} /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Notes Tab */}
      {activeTab === 'notes' && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StickyNote size={14} className="text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-100">Server Notes</h3>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              {notesSaving && <><Spinner size="sm" /><span>Saving...</span></>}
              {!notesSaving && notesSavedAt && (
                <span className="flex items-center gap-1"><Save size={11} /> Saved {notesSavedAt.toLocaleTimeString()}</span>
              )}
            </div>
          </div>
          <div className="p-4">
            <p className="text-xs text-slate-500 mb-3">Notes are auto-saved after 1.5 seconds. Only visible to you.</p>
            <textarea
              className="w-full h-72 bg-dark-950 border border-slate-700/50 rounded-lg p-3 font-mono text-sm text-slate-300 resize-y focus:outline-none focus:border-panel-500/50 transition-colors"
              placeholder="Write your notes here... (e.g. admin credentials, mod list, server notes)"
              value={notesContent}
              onChange={(e) => handleNotesChange(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>
      )}

      {/* Schedule Tab */}
      {activeTab === 'schedule' && (
        <div className="space-y-4">
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarClock size={14} className="text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-100">Scheduled Tasks</h3>
              </div>
              <button className="btn-primary btn-sm" onClick={() => setShowScheduleModal(true)}>
                <Plus size={13} /> New Task
              </button>
            </div>
            {schedulesLoading ? (
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : schedules.length === 0 ? (
              <div className="p-10 text-center text-slate-500">
                <CalendarClock size={32} className="mx-auto mb-2 opacity-20" />
                <p className="text-sm">No scheduled tasks</p>
                <p className="text-xs mt-1">Create tasks to automate server actions</p>
              </div>
            ) : (
              <div className="divide-y divide-dark-800/50">
                {schedules.map((task) => (
                  <div key={task.id} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-slate-200">{task.name}</p>
                        <span className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide',
                          task.enabled ? 'bg-green-500/15 text-green-400' : 'bg-slate-700/50 text-slate-500'
                        )}>
                          {task.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-dark-700 text-slate-400 uppercase tracking-wide">
                          {task.action}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500 flex-wrap">
                        <span className="font-mono">{task.cronExpression}</span>
                        {task.payload && <span>→ {task.payload}</span>}
                        {task.nextRunAt && (
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            Next: {new Date(task.nextRunAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"
                      onClick={() => deleteSchedule(task.id)}
                      disabled={deletingSchedule === task.id}
                      title="Delete task"
                    >
                      {deletingSchedule === task.id ? <Spinner size="sm" /> : <Trash2 size={13} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Schedule Create Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowScheduleModal(false)}>
          <div className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700">
              <h3 className="text-slate-100 font-semibold">New Scheduled Task</h3>
              <button className="text-slate-500 hover:text-slate-300" onClick={() => setShowScheduleModal(false)}><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="label">Task Name</label>
                <input
                  className="input w-full"
                  placeholder="e.g. Daily restart"
                  value={scheduleForm.name}
                  onChange={(e) => setScheduleForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Action</label>
                <select
                  className="input w-full"
                  value={scheduleForm.action}
                  onChange={(e) => setScheduleForm(f => ({ ...f, action: e.target.value as typeof scheduleForm.action }))}
                >
                  <option value="command">Run Command</option>
                  <option value="power">Power Action</option>
                  <option value="backup">Create Backup</option>
                </select>
              </div>
              {scheduleForm.action === 'command' && (
                <div>
                  <label className="label">Command</label>
                  <input
                    className="input w-full font-mono"
                    placeholder="say Server restarting in 5 minutes"
                    value={scheduleForm.command}
                    onChange={(e) => setScheduleForm(f => ({ ...f, command: e.target.value }))}
                  />
                </div>
              )}
              {scheduleForm.action === 'power' && (
                <div>
                  <label className="label">Power Action</label>
                  <select
                    className="input w-full"
                    value={scheduleForm.powerAction}
                    onChange={(e) => setScheduleForm(f => ({ ...f, powerAction: e.target.value as typeof scheduleForm.powerAction }))}
                  >
                    <option value="start">Start</option>
                    <option value="stop">Stop</option>
                    <option value="restart">Restart</option>
                    <option value="kill">Kill</option>
                  </select>
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="label mb-0">Cron Expression</label>
                  <div className="flex gap-1 flex-wrap">
                    {[
                      { label: 'Every hour', value: '0 * * * *' },
                      { label: 'Daily 3am', value: '0 3 * * *' },
                      { label: 'Sunday 4am', value: '0 4 * * 0' },
                    ].map(preset => (
                      <button
                        key={preset.value}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-dark-700 text-slate-400 hover:text-panel-400 hover:bg-dark-600 transition-colors"
                        onClick={() => setScheduleForm(f => ({ ...f, cronExpression: preset.value }))}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  className="input w-full font-mono"
                  placeholder="0 3 * * * (every day at 3am)"
                  value={scheduleForm.cronExpression}
                  onChange={(e) => setScheduleForm(f => ({ ...f, cronExpression: e.target.value }))}
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  role="switch"
                  aria-checked={scheduleForm.enabled}
                  onClick={() => setScheduleForm(f => ({ ...f, enabled: !f.enabled }))}
                  className={cn(
                    'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none',
                    scheduleForm.enabled ? 'bg-panel-500' : 'bg-dark-600'
                  )}
                >
                  <span className={cn(
                    'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
                    scheduleForm.enabled ? 'translate-x-4' : 'translate-x-0.5'
                  )} />
                </button>
                <span className="text-sm text-slate-300">Enabled</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-dark-700">
              <button className="btn-secondary btn-sm" onClick={() => setShowScheduleModal(false)}>Cancel</button>
              <button
                className="btn-primary btn-sm"
                disabled={savingSchedule || !scheduleForm.name.trim() || !scheduleForm.cronExpression.trim()}
                onClick={createSchedule}
              >
                {savingSchedule ? <Spinner size="sm" /> : <><Check size={13} /> Create Task</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Access Tab */}
      {activeTab === 'access' && (
        <div className="space-y-4">
          {/* Add sub-user */}
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <UserCog size={14} className="text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-100">Grant Server Access</h3>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">User Email</label>
                <input
                  className="input w-full"
                  type="email"
                  placeholder="user@example.com"
                  value={accessEmail}
                  onChange={(e) => setAccessEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="label mb-2">Permissions</label>
                <div className="flex flex-wrap gap-3">
                  {(['console', 'files', 'power', 'players', 'backups'] as const).map(perm => (
                    <label key={perm} className="flex items-center gap-1.5 cursor-pointer text-sm text-slate-300">
                      <input
                        type="checkbox"
                        className="rounded border-dark-600 bg-dark-700 text-panel-500 focus:ring-panel-500 focus:ring-offset-dark-800"
                        checked={accessPerms[perm]}
                        onChange={(e) => setAccessPerms(p => ({ ...p, [perm]: e.target.checked }))}
                      />
                      <span className="capitalize">{perm}</span>
                    </label>
                  ))}
                </div>
              </div>
              <button
                className="btn-primary btn-sm"
                disabled={addingAccess || !accessEmail.trim()}
                onClick={addSubUser}
              >
                {addingAccess ? <Spinner size="sm" /> : <><Plus size={13} /> Grant Access</>}
              </button>
            </div>
          </div>

          {/* Sub-users list */}
          <div className="card">
            <div className="card-header">
              <h3 className="text-sm font-semibold text-slate-100">Users with Access</h3>
            </div>
            {subUsersLoading ? (
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : subUsers.length === 0 ? (
              <div className="p-10 text-center text-slate-500">
                <Users size={32} className="mx-auto mb-2 opacity-20" />
                <p className="text-sm">No sub-users</p>
                <p className="text-xs mt-1">Add users above to grant access to this server</p>
              </div>
            ) : (
              <div className="divide-y divide-dark-800/50">
                {subUsers.map((user) => (
                  <div key={user.id} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="h-8 w-8 rounded-full bg-panel-500/20 flex items-center justify-center text-panel-400 text-xs font-bold uppercase shrink-0">
                      {user.email[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-200 truncate">{user.email}</p>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {(user.permissions || []).map(perm => (
                          <span key={perm} className="text-[10px] px-1.5 py-0.5 rounded-full bg-dark-700 text-slate-400 capitalize">{perm}</span>
                        ))}
                        {(!user.permissions || user.permissions.length === 0) && (
                          <span className="text-[10px] text-slate-600">No permissions</span>
                        )}
                      </div>
                    </div>
                    <button
                      className="btn-danger btn-sm shrink-0"
                      disabled={removingAccess === user.id}
                      onClick={() => removeSubUser(user.id)}
                    >
                      {removingAccess === user.id ? <Spinner size="sm" /> : <><Trash2 size={12} /> Remove</>}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Inventory Modal (console tab quick view — Java only) */}
      {!isBedrock && inventoryPlayer && !selectedPlayer && (
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
              <p className="text-slate-500 text-sm text-center py-8">Could not read inventory.</p>
            ) : (
              <div className="space-y-6">
                <MCInventoryGrid items={playerInventory.inventory} />
                <MCInventoryGrid items={playerInventory.enderChest} isEnderChest />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Player Detail Modal (Players tab) */}
      {selectedPlayer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => { setSelectedPlayer(null); setPlayerDetails(null); }}>
          <div className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div className="sticky top-0 bg-dark-800 border-b border-dark-700 px-6 py-4 flex items-center gap-3 z-10">
              <img src={`https://mc-heads.net/avatar/${selectedPlayer.name}/48`} alt="" className="w-12 h-12 rounded pixelated shrink-0" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-bold text-slate-100">{selectedPlayer.name}</h2>
                  {selectedPlayer.online
                    ? <span className="badge-green text-xs">Online</span>
                    : <span className="text-xs text-slate-500 bg-dark-700 px-2 py-0.5 rounded-full">Offline</span>
                  }
                  {playerDetails?.ban?.banned && (
                    <span className="text-xs text-red-300 bg-red-500/15 border border-red-500/20 px-2 py-0.5 rounded-full flex items-center gap-1"><Ban size={10} />Banned</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 font-mono truncate">{selectedPlayer.uuid || 'UUID unknown'}</p>
              </div>
              <button className="text-slate-500 hover:text-slate-200 shrink-0" onClick={() => { setSelectedPlayer(null); setPlayerDetails(null); }}><X size={20} /></button>
            </div>

            <div className="p-6 space-y-6">
              {playerDetailsLoading ? (
                <div className="flex justify-center py-10"><Spinner size="lg" /></div>
              ) : (
                <>
                  {/* Stats grid */}
                  {playerDetails?.stats && (
                    <section>
                      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Statistics</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          { icon: <Clock size={13} />, label: 'Play Time', value: (() => { const h = Math.floor(playerDetails.stats.playTimeTicks / 72000); const m = Math.floor((playerDetails.stats.playTimeTicks % 72000) / 1200); return h > 0 ? `${h}h ${m}m` : `${m}m`; })() },
                          { icon: <Sword size={13} />, label: 'Deaths', value: String(playerDetails.stats.deaths) },
                          { icon: <Footprints size={13} />, label: 'Distance', value: (() => { const km = ((playerDetails.stats.walkOneCm + playerDetails.stats.sprintOneCm) / 100000); return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`; })() },
                          { icon: <Hammer size={13} />, label: 'Blocks Mined', value: playerDetails.stats.blocksMinedTotal.toLocaleString() },
                        ].map(s => (
                          <div key={s.label} className="bg-dark-700/60 border border-dark-600 rounded-lg p-3">
                            <div className="flex items-center gap-1.5 text-slate-500 mb-1">{s.icon}<span className="text-xs">{s.label}</span></div>
                            <p className="text-sm font-semibold text-slate-100">{s.value}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Location */}
                  {playerDetails?.location && (
                    <section>
                      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Last Known Location</h3>
                      <div className="bg-dark-700/60 border border-dark-600 rounded-lg p-4 flex items-center gap-4 flex-wrap">
                        <MapPin size={16} className="text-panel-400 shrink-0" />
                        <div className="flex gap-4 text-sm flex-wrap">
                          <span className="text-slate-300">X: <span className="font-mono text-slate-100">{playerDetails.location.x}</span></span>
                          <span className="text-slate-300">Y: <span className="font-mono text-slate-100">{playerDetails.location.y}</span></span>
                          <span className="text-slate-300">Z: <span className="font-mono text-slate-100">{playerDetails.location.z}</span></span>
                          <span className="text-slate-300">Dim: <span className="font-mono text-slate-100 capitalize">{playerDetails.location.dimension}</span></span>
                        </div>
                        <div className="flex gap-3 text-sm ml-auto">
                          <span className="text-slate-400">❤️ <span className="text-slate-100">{playerDetails.location.health}/20</span></span>
                          <span className="text-slate-400">⭐ <span className="text-slate-100">Lv {playerDetails.location.xpLevel}</span></span>
                        </div>
                      </div>
                    </section>
                  )}

                  {/* Ban status */}
                  <section>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Ban Status</h3>
                    {playerDetails?.ban?.banned ? (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-red-300 flex items-center gap-1.5"><Ban size={14} />Currently Banned</p>
                            <p className="text-xs text-slate-400 mt-1">Reason: <span className="text-slate-200">{playerDetails.ban.reason}</span></p>
                            <p className="text-xs text-slate-500 mt-0.5">By: {playerDetails.ban.bannedBy} · Expires: {playerDetails.ban.expires}</p>
                          </div>
                          <button
                            className="btn-secondary btn-sm shrink-0"
                            disabled={playerActionLoading === 'unban'}
                            onClick={() => playerAction('unban', selectedPlayer)}
                          >
                            {playerActionLoading === 'unban' ? <Spinner size="sm" /> : <><ShieldOff size={13} />Unban</>}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">Player is not banned.</p>
                    )}
                  </section>

                  {/* Inventory — Java Edition only (Bedrock uses different data formats) */}
                  {!isBedrock && playerDetails && (
                    <section>
                      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Inventory</h3>
                      <MCInventoryGrid items={playerDetails.inventory} onDelete={slot => deleteInventoryItem(selectedPlayer, slot, false)} />
                      <div className="mt-6">
                        <MCInventoryGrid items={playerDetails.enderChest} isEnderChest onDelete={slot => deleteInventoryItem(selectedPlayer, slot, true)} />
                      </div>
                    </section>
                  )}

                  {/* Actions */}
                  <section>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Actions</h3>
                    <div className="space-y-3">
                      {/* Teleport — only when player is online */}
                      {selectedPlayer.online && (
                        <div className="flex gap-2">
                          <input
                            className="input flex-1 text-sm"
                            placeholder="Your in-game name (admin)..."
                            value={tpAdminName}
                            onChange={e => { setTpAdminName(e.target.value); localStorage.setItem('mcAdminName', e.target.value); }}
                          />
                          <button
                            className="btn-primary btn-sm shrink-0"
                            disabled={playerActionLoading === 'tp'}
                            onClick={() => playerAction('tp', selectedPlayer)}
                          >
                            {playerActionLoading === 'tp' ? <Spinner size="sm" /> : <><Navigation size={13} />TP Here</>}
                          </button>
                        </div>
                      )}
                      {/* Kick */}
                      {selectedPlayer.online && (
                        <div className="flex gap-2">
                          <input className="input flex-1 text-sm" placeholder="Kick reason..." value={kickReason} onChange={e => setKickReason(e.target.value)} />
                          <button
                            className="btn-secondary btn-sm shrink-0"
                            disabled={playerActionLoading === 'kick'}
                            onClick={() => playerAction('kick', selectedPlayer)}
                          >
                            {playerActionLoading === 'kick' ? <Spinner size="sm" /> : <><LogOut size={13} />Kick</>}
                          </button>
                        </div>
                      )}
                      {/* Ban */}
                      {!playerDetails?.ban?.banned && (
                        <div className="flex gap-2">
                          <input className="input flex-1 text-sm" placeholder="Ban reason..." value={banReason} onChange={e => setBanReason(e.target.value)} />
                          <button
                            className="btn-danger btn-sm shrink-0"
                            disabled={playerActionLoading === 'ban'}
                            onClick={() => playerAction('ban', selectedPlayer)}
                          >
                            {playerActionLoading === 'ban' ? <Spinner size="sm" /> : <><Ban size={13} />Ban</>}
                          </button>
                          <button
                            className="btn-danger btn-sm shrink-0"
                            title="IP Ban"
                            disabled={playerActionLoading === 'ipban'}
                            onClick={() => playerAction('ipban', selectedPlayer)}
                          >
                            {playerActionLoading === 'ipban' ? <Spinner size="sm" /> : <><Wifi size={13} />IP Ban</>}
                          </button>
                        </div>
                      )}
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getItemStyle(id: string): { bg: string; fg: string } {
  const s = id.toLowerCase();
  if (s.includes('diamond'))   return { bg: '#0e3d4a', fg: '#00d8ff' };
  if (s.includes('netherite')) return { bg: '#2d1a2d', fg: '#9b7fa6' };
  if (s.includes('gold') || s.includes('golden')) return { bg: '#3d3000', fg: '#ffd700' };
  if (s.includes('emerald'))   return { bg: '#0a2e0a', fg: '#00c020' };
  if (s.includes('redstone'))  return { bg: '#2e0a0a', fg: '#ff4444' };
  if (s.includes('obsidian') || s.includes('ancient_debris')) return { bg: '#1a0a2e', fg: '#7a4fd4' };
  if (s.includes('iron'))      return { bg: '#252525', fg: '#c0c0c0' };
  if (s.includes('lapis'))     return { bg: '#0a0a2e', fg: '#4488ff' };
  if (s.includes('coal'))      return { bg: '#1a1a1a', fg: '#666' };
  if (s.includes('potion') || s.includes('enchanted')) return { bg: '#0a1020', fg: '#6699ff' };
  if (s.includes('sword') || s.includes('axe') || s.includes('pickaxe') || s.includes('shovel') || s.includes('hoe')) return { bg: '#1a1a30', fg: '#aaaaff' };
  if (s.includes('helmet') || s.includes('chestplate') || s.includes('leggings') || s.includes('boots')) return { bg: '#1a2e1a', fg: '#44cc88' };
  if (s.includes('bow') || s.includes('arrow') || s.includes('crossbow')) return { bg: '#2a1a00', fg: '#cc8844' };
  if (s.includes('apple') || s.includes('bread') || s.includes('beef') || s.includes('chicken') || s.includes('fish') || s.includes('carrot') || s.includes('potato')) return { bg: '#2e1a0a', fg: '#ff8844' };
  if (s.includes('oak') || s.includes('birch') || s.includes('spruce') || s.includes('acacia') || s.includes('plank') || s.includes('log')) return { bg: '#2a1a00', fg: '#c87840' };
  if (s.includes('stone') || s.includes('cobble') || s.includes('brick')) return { bg: '#1e1e1e', fg: '#888' };
  if (s.includes('grass') || s.includes('dirt') || s.includes('sand')) return { bg: '#152e0a', fg: '#66aa44' };
  if (s.includes('glass') || s.includes('ice'))   return { bg: '#0a1a2e', fg: '#88aaff' };
  if (s.includes('tnt') || s.includes('fire') || s.includes('lava')) return { bg: '#2e1000', fg: '#ff6600' };
  return { bg: '#1a2030', fg: '#778899' };
}

function itemAbbr(id: string): string {
  return id.split('_').map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 3);
}

function MCSlot({ item, onDelete }: { item?: NbtItem; onDelete?: (slot: number) => void }) {
  if (!item) {
    return (
      <div
        className="w-9 h-9 rounded-sm flex-shrink-0"
        style={{ background: '#1a2030', border: '1px solid #0d1520', boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.6), inset -1px -1px 0 rgba(255,255,255,0.04)' }}
      />
    );
  }
  const { bg, fg } = getItemStyle(item.id);
  return (
    <div
      className="relative group flex-shrink-0 cursor-default"
      title={`${item.id.replace(/_/g, ' ')} ×${item.count}  [slot ${item.slot}]`}
    >
      <div
        className="w-9 h-9 rounded-sm flex items-center justify-center relative overflow-hidden"
        style={{ background: bg, border: `1px solid ${fg}30`, boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.07), inset -1px -1px 0 rgba(0,0,0,0.5)' }}
      >
        <span className="text-[7px] font-bold select-none" style={{ color: fg }}>{itemAbbr(item.id)}</span>
        {item.count > 1 && (
          <span className="absolute bottom-0 right-0.5 text-[8px] font-bold leading-none select-none"
            style={{ color: '#fff', textShadow: '1px 1px 0 #000, -0.5px -0.5px 0 #000' }}>
            {item.count}
          </span>
        )}
      </div>
      {onDelete && (
        <button
          onClick={() => onDelete(item.slot)}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 hover:bg-red-400 text-white rounded-full hidden group-hover:flex items-center justify-center shadow z-10"
          title="Remove"
        ><X size={7} /></button>
      )}
    </div>
  );
}

function MCInventoryGrid({ items, isEnderChest = false, onDelete }: {
  items: NbtItem[];
  isEnderChest?: boolean;
  onDelete?: (slot: number) => void;
}) {
  const slotMap = new Map(items.map(i => [i.slot, i]));

  const row = (slots: number[]) => (
    <div className="flex gap-0.5">
      {slots.map(s => <MCSlot key={s} item={slotMap.get(s)} onDelete={onDelete} />)}
    </div>
  );

  if (isEnderChest) {
    const used = items.filter(i => i.slot >= 0 && i.slot <= 26).length;
    return (
      <div>
        <p className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-2">
          Ender Chest
          <span className="text-slate-600 font-normal">{used}/27 slots</span>
        </p>
        <div className="inline-flex flex-col gap-0.5 p-1.5 rounded"
          style={{ background: '#130a1e', border: '2px solid #3d1a5e' }}>
          {row(Array.from({ length: 9 }, (_, i) => i))}
          {row(Array.from({ length: 9 }, (_, i) => 9 + i))}
          {row(Array.from({ length: 9 }, (_, i) => 18 + i))}
        </div>
      </div>
    );
  }

  // Main inventory: armor (36-39) + main (9-35) + hotbar (0-8)
  const armorSlots  = [39, 38, 37, 36]; // helmet → boots
  const armorLabels = ['⛑', '🦺', '👗', '👢'];
  const usedMain = items.filter(i => i.slot >= 0 && i.slot <= 39).length;

  return (
    <div>
      <p className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-2">
        Inventory
        <span className="text-slate-600 font-normal">{usedMain}/40 slots</span>
      </p>
      <div className="inline-flex flex-col gap-1 p-1.5 rounded"
        style={{ background: '#0d1520', border: '2px solid #1e3050' }}>

        {/* Armor column */}
        <div className="flex gap-0.5 mb-0.5">
          {armorSlots.map((s, i) => {
            const item = slotMap.get(s);
            return item
              ? <MCSlot key={s} item={item} onDelete={onDelete} />
              : (
                <div key={s} className="w-9 h-9 rounded-sm flex items-center justify-center flex-shrink-0"
                  title={`Armor slot ${s} (empty)`}
                  style={{ background: '#131f30', border: '1px solid #1e3050', opacity: 0.5 }}>
                  <span className="text-sm select-none">{armorLabels[i]}</span>
                </div>
              );
          })}
          <div className="ml-1 text-[9px] text-slate-600 self-center leading-tight">armor</div>
        </div>

        {/* Main inventory (slots 9–35) */}
        {row(Array.from({ length: 9 }, (_, i) => 9 + i))}
        {row(Array.from({ length: 9 }, (_, i) => 18 + i))}
        {row(Array.from({ length: 9 }, (_, i) => 27 + i))}

        {/* Hotbar separator */}
        <div className="my-0.5 border-t" style={{ borderColor: '#1e3050' }} />

        {/* Hotbar (slots 0–8) */}
        {row(Array.from({ length: 9 }, (_, i) => i))}
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

function StatsSparklines({ history }: { history: StatsHistoryPoint[] }) {
  const W = 300;
  const H = 80;
  const PAD = { top: 8, right: 8, bottom: 20, left: 28 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  if (!history || history.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-slate-600 text-xs rounded-lg"
        style={{ width: W, height: H, background: '#0b0f14' }}
      >
        No history data yet
      </div>
    );
  }

  const n = history.length;

  const cpuVals = history.map((p) => Math.min(p.cpuAbsolute ?? 0, 100));
  const ramVals = history.map((p) =>
    p.memoryLimitBytes > 0 ? Math.min((p.memoryBytes / p.memoryLimitBytes) * 100, 100) : 0
  );

  const buildPath = (vals: number[]) => {
    const xStep = n > 1 ? innerW / (n - 1) : innerW;
    return vals.map((v, i) => {
      const x = PAD.left + i * xStep;
      const y = PAD.top + innerH - (v / 100) * innerH;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  };

  const cpuPath = buildPath(cpuVals);
  const ramPath = buildPath(ramVals);

  // axis labels
  const yLabels = [0, 25, 50, 75, 100];

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      style={{ background: '#0b0f14', borderRadius: 8, display: 'block' }}
      aria-label="Resource usage graph"
    >
      {/* Grid lines */}
      {yLabels.map((pct) => {
        const y = PAD.top + innerH - (pct / 100) * innerH;
        return (
          <g key={pct}>
            <line
              x1={PAD.left} y1={y} x2={PAD.left + innerW} y2={y}
              stroke="#1e293b" strokeWidth="0.5"
            />
            <text x={PAD.left - 3} y={y + 3.5} textAnchor="end" fill="#475569" fontSize="7">
              {pct}%
            </text>
          </g>
        );
      })}

      {/* X axis label */}
      <text x={PAD.left + innerW / 2} y={H - 3} textAnchor="middle" fill="#475569" fontSize="7">
        Time
      </text>

      {/* CPU line (green) */}
      <path d={cpuPath} fill="none" stroke="#4ade80" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />

      {/* RAM line (blue) */}
      <path d={ramPath} fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />

      {/* Latest values */}
      {n > 0 && (() => {
        const lastCpu = cpuVals[n - 1];
        const lastRam = ramVals[n - 1];
        const xStep = n > 1 ? innerW / (n - 1) : innerW;
        const cx = PAD.left + (n - 1) * xStep;
        const cpuY = PAD.top + innerH - (lastCpu / 100) * innerH;
        const ramY = PAD.top + innerH - (lastRam / 100) * innerH;
        return (
          <>
            <circle cx={cx} cy={cpuY} r="2.5" fill="#4ade80" />
            <circle cx={cx} cy={ramY} r="2.5" fill="#60a5fa" />
          </>
        );
      })()}
    </svg>
  );
}
