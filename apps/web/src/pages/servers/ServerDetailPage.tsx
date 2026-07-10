import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Play, Square, RotateCcw, Zap, Terminal, BarChart2,
  HardDrive, Archive, ChevronLeft, Cpu, MemoryStick,
  Folder, FolderOpen, File, ChevronRight, ArrowLeft, Pencil, Trash2, Plus, X, Check,
  Package, Users, Search, Download, RefreshCw, Tag, AlertTriangle, Shield, ShieldOff,
  MapPin, Clock, Sword, Hammer, Footprints, Ban, LogOut, Wifi, Navigation,
  StickyNote, CalendarClock, UserCog, Save, Copy, CheckCircle2, Globe2, Boxes,
  Settings as SettingsIcon, Gauge, RotateCw, Trophy, Map as MapIcon,
  ExternalLink, Palette, Bot, KeyRound, ArrowDown, Eraser
} from 'lucide-react';
import { io as ioClient, Socket } from 'socket.io-client';
import api from '@/lib/axios';
import { useAuthStore } from '@/store/authStore';
import { useSettings } from '@/hooks/useSettings';
import { Server, ServerStats, ServerStatus } from '@/types';
import {
  getServerStatusDot, getServerStatusBadge, formatBytes, formatUptime
} from '@/lib/utils';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import { PluginManager } from './PluginManager';
import { ModManager } from './ModManager';
import { WorldManager } from './WorldManager';
import { WorldMapViewer } from './WorldMapViewer';
import { PublicPageCustomizer } from './PublicPageCustomizer';
import { ModpackManager } from './ModpackManager';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';

type Tab = 'console' | 'files' | 'plugins' | 'mods' | 'modpacks' | 'versions' | 'worlds' | 'map' | 'stats' | 'backups' | 'players' | 'leaderboard' | 'notes' | 'schedule' | 'access' | 'customize' | 'settings';

const TAB_GROUPS: { label: string; tabs: { id: Tab; label: string; icon: typeof Terminal }[] }[] = [
  {
    label: 'manage',
    tabs: [
      { id: 'console', label: 'Console', icon: Terminal },
      { id: 'files', label: 'Files', icon: Folder },
      { id: 'plugins', label: 'Plugins', icon: Package },
      { id: 'mods', label: 'Mods', icon: Hammer },
      { id: 'modpacks', label: 'Modpacks', icon: Boxes },
      { id: 'versions', label: 'Versions', icon: Tag },
      { id: 'worlds', label: 'Worlds', icon: Globe2 },
      { id: 'map', label: 'Map', icon: MapIcon },
    ],
  },
  {
    label: 'monitor',
    tabs: [
      { id: 'stats', label: 'Stats', icon: BarChart2 },
      { id: 'backups', label: 'Backups', icon: Archive },
      { id: 'players', label: 'Players', icon: Users },
      { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
    ],
  },
  {
    label: 'admin',
    tabs: [
      { id: 'notes', label: 'Notes', icon: StickyNote },
      { id: 'schedule', label: 'Schedule', icon: CalendarClock },
      { id: 'access', label: 'Access', icon: UserCog },
      { id: 'customize', label: 'Customize', icon: Palette },
      { id: 'settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
];

// ── Schedule types ─────────────────────────────────────────────────────────────
interface ScheduledTask {
  id: string;
  name: string;
  action: 'command' | 'power' | 'backup';
  payload?: string;
  cronExpression: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
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

interface PaperBuild {
  id: number;
  time: string;
  channel: string;
  commits: { sha: string; message: string; time: string }[];
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

// Common Minecraft server console commands (vanilla + Paper/Spigot + the most
// common Essentials/permissions extras), used to power the type-ahead
// suggestion dropdown in the console. Matched by first-word prefix only, so a
// server running a non-Minecraft egg simply gets no matches from this list —
// its own command history still drives suggestions. Not exhaustive by design:
// enough to cover what an operator reaches for daily.
const COMMON_MC_COMMANDS = [
  'help', 'list', 'stop', 'restart', 'reload', 'save-all', 'save-off', 'save-on',
  'op', 'deop', 'ban', 'ban-ip', 'banlist', 'kick', 'pardon', 'pardon-ip',
  'whitelist', 'gamemode', 'defaultgamemode', 'gamerule', 'give', 'clear',
  'tp', 'teleport', 'spawnpoint', 'setworldspawn', 'worldborder',
  'time', 'weather', 'difficulty', 'kill', 'effect', 'enchant', 'xp', 'experience',
  'say', 'tell', 'msg', 'me', 'tellraw', 'title', 'seed', 'summon', 'setblock',
  'fill', 'clone', 'particle', 'playsound', 'scoreboard', 'team', 'advancement',
  'attribute', 'bossbar', 'data', 'datapack', 'function', 'loot', 'locate',
  'recipe', 'schedule', 'spectate', 'trigger', 'spreadplayers',
  'plugins', 'version', 'timings', 'tps', 'mspt', 'gc',
  'fly', 'heal', 'feed', 'god', 'home', 'sethome', 'warp', 'setwarp', 'spawn',
  'back', 'near', 'kit', 'tpa', 'tpaccept', 'tpahere', 'broadcast', 'vanish',
  'invsee', 'enderchest', 'workbench', 'repair', 'speed', 'nick', 'mute',
].sort();

interface NbtItem { slot: number; id: string; count: number; }

interface PlayerHistoryEntry {
  name: string;
  uuid: string;
  firstSeen: string;
  lastSeen: string;
  joinCount: number;
  online: boolean;
}

interface LeaderboardEntry {
  uuid: string;
  name: string;
  playTimeTicks: number;
  deaths: number;
  walkOneCm: number;
  sprintOneCm: number;
  jumps: number;
  playerKills: number;
  mobKills: number;
  blocksMinedTotal: number;
}

type LeaderboardSortKey = Exclude<keyof LeaderboardEntry, 'uuid' | 'name'>;

const LEADERBOARD_COLUMNS: { key: LeaderboardSortKey; label: string }[] = [
  { key: 'playTimeTicks', label: 'Playtime' },
  { key: 'mobKills', label: 'Mob Kills' },
  { key: 'playerKills', label: 'Player Kills' },
  { key: 'deaths', label: 'Deaths' },
  { key: 'blocksMinedTotal', label: 'Blocks Mined' },
  { key: 'jumps', label: 'Jumps' },
];

function formatPlaytime(ticks: number): string {
  const hours = ticks / 20 / 3600;
  if (hours < 1) return `${Math.round(ticks / 20 / 60)}m`;
  return `${hours.toFixed(1)}h`;
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
  const { accessToken, user } = useAuthStore();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('console');
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [command, setCommand] = useState('');
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [currentStatus, setCurrentStatus] = useState<ServerStatus>('OFFLINE');
  const [ipCopied, setIpCopied] = useState(false);
  const [showEulaModal, setShowEulaModal] = useState(false);
  const [acceptingEula, setAcceptingEula] = useState(false);
  const [discordBindCode, setDiscordBindCode] = useState<string | null>(null);
  const [generatingBindCode, setGeneratingBindCode] = useState(false);
  const { data: siteSettings } = useSettings();
  const socketRef = useRef<Socket | null>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const consoleScrollRef = useRef<HTMLDivElement>(null);
  // Only auto-follow new output while the user is parked at the bottom — if
  // they've scrolled up to read something, don't yank the view back down on
  // every incoming line (the old behavior, which made reading scrollback
  // impossible on a chatty server).
  const [autoScroll, setAutoScroll] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [consoleSearch, setConsoleSearch] = useState('');
  // Shell-style command history: ↑/↓ in the input cycle previously sent
  // commands. Index is a ref so cycling doesn't trigger a re-render per key.
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  // Type-ahead command suggestions (the "type h → help/heal" dropdown).
  const commandInputRef = useRef<HTMLInputElement>(null);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [suggestDismissed, setSuggestDismissed] = useState(false);

  const isTransitional = currentStatus === 'STARTING' || currentStatus === 'STOPPING';

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['server', id],
    queryFn: () => api.get(`/servers/${id}`).then((r) => r.data.data as Server),
    enabled: !!id,
    refetchInterval: isTransitional || currentStatus === 'INSTALLING' ? 3000 : false,
  });

  const [currentDir, setCurrentDir] = useState('/');
  const [editingFile, setEditingFile] = useState<{ path: string; content: string } | null>(null);
  const [editContent, setEditContent] = useState('');
  const [savingFile, setSavingFile] = useState(false);

  // Version management
  const [versions, setVersions] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [builds, setBuilds] = useState<PaperBuild[]>([]);
  const [selectedBuild, setSelectedBuild] = useState<number | 'latest'>('latest');
  const [versionLoading, setVersionLoading] = useState(false);
  const [installing_version, setInstallingVersion] = useState(false);
  const [downgradeConfirmed, setDowngradeConfirmed] = useState(false);
  const [backupBeforeInstall, setBackupBeforeInstall] = useState(true);

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
    enabled: (activeTab === 'players' || activeTab === 'console') && !!id,
    refetchInterval: (activeTab === 'players' || activeTab === 'console') ? 30000 : false,
  });

  const [leaderboardSort, setLeaderboardSort] = useState<LeaderboardSortKey>('playTimeTicks');
  const { data: leaderboardData, isLoading: leaderboardLoading } = useQuery({
    queryKey: ['server-leaderboard', id],
    queryFn: () => api.get(`/servers/${id}/players/leaderboard`).then((r) => r.data),
    enabled: activeTab === 'leaderboard' && !!id,
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
    // Archiving a real backup can take a while — keep polling while any
    // backup is still pending so the UI flips to "done" on its own.
    refetchInterval: (query) => {
      const backups = (query.state.data as { isSuccessful: boolean }[] | undefined) || [];
      return backups.some((b) => !b.isSuccessful) ? 4000 : false;
    },
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

  // Server behavior settings (crash auto-restart, lag auto-optimize)
  const [crashDetectionEnabled, setCrashDetectionEnabled] = useState(true);
  const [autoOptimizeEnabled, setAutoOptimizeEnabled] = useState(true);
  const [publicStatusEnabled, setPublicStatusEnabled] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  useEffect(() => {
    if (data) {
      setCrashDetectionEnabled(data.crashDetectionEnabled ?? true);
      setAutoOptimizeEnabled(data.autoOptimizeEnabled ?? true);
      setPublicStatusEnabled(data.publicStatusEnabled ?? false);
    }
  }, [data]);

  const saveServerSettings = async () => {
    setSavingSettings(true);
    try {
      await api.patch(`/servers/${id}`, { crashDetectionEnabled, autoOptimizeEnabled, publicStatusEnabled });
      toast.success('Settings saved');
      queryClient.invalidateQueries({ queryKey: ['server', id] });
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
      toast.error(message || 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const generateDiscordBindCode = async () => {
    setGeneratingBindCode(true);
    try {
      const { data } = await api.post(`/servers/${id}/discord/bind-code`);
      setDiscordBindCode(data.code);
    } catch {
      toast.error('Failed to generate a code');
    } finally {
      setGeneratingBindCode(false);
    }
  };

  // Stats history
  const { data: statsHistory } = useQuery({
    queryKey: ['server-stats-history', id],
    queryFn: () => api.get(`/servers/${id}/stats/history`).then((r) => r.data),
    enabled: activeTab === 'stats' && !!id,
    refetchInterval: activeTab === 'stats' ? 10000 : false,
  });

  // Longer-range history (DB-backed, unlike the live in-memory buffer above)
  const [historyRange, setHistoryRange] = useState<'1h' | '24h' | '7d'>('1h');
  const { data: longStatsHistory } = useQuery({
    queryKey: ['server-stats-history-range', id, historyRange],
    queryFn: () => api.get(`/servers/${id}/stats/history`, { params: { range: historyRange } }).then((r) => r.data),
    enabled: activeTab === 'stats' && !!id,
    refetchInterval: activeTab === 'stats' ? 60000 : false,
  });

  const { data: healthData } = useQuery({
    queryKey: ['server-health', id],
    queryFn: () => api.get(`/servers/${id}/health`).then((r) => r.data),
    enabled: activeTab === 'stats' && !!id,
    refetchInterval: activeTab === 'stats' ? 60000 : false,
  });

  useEffect(() => {
    if (data?.status) setCurrentStatus(data.status as ServerStatus);
  }, [data?.status]);

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
    if (activeTab === 'versions' && id && versions.length === 0) loadVersions();
  }, [activeTab, id]);

  useEffect(() => {
    if (selectedVersion) loadBuilds(selectedVersion);
    setDowngradeConfirmed(false);
  }, [selectedVersion]);

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
    if (isDowngrade && !downgradeConfirmed) {
      toast.error('Confirm you understand the downgrade risk first');
      return;
    }
    setInstallingVersion(true);
    try {
      if (backupBeforeInstall) {
        try {
          await api.post(`/servers/${id}/backups`, { name: `Before version change to ${selectedVersion}` });
          toast.success('Backup queued');
        } catch {
          toast.error('Backup failed to start — continuing with version install anyway');
        }
      }
      const payload = { version: selectedVersion, build: selectedBuild === 'latest' ? undefined : selectedBuild };
      const { data: versionData } = await api.post(`/servers/${id}/version`, payload, { timeout: 180000 });
      // Persist the installed MC version so plugin installer can pick the right build
      await api.patch(`/servers/${id}`, { mcVersion: selectedVersion }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['server', id] });
      setDowngradeConfirmed(false);
      toast.success(versionData.message || 'Version installed! Restart the server to apply.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Version change failed';
      toast.error(msg);
    } finally {
      setInstallingVersion(false);
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

    socket.on('error', (message: string) => {
      if (message === 'EULA_NOT_ACCEPTED') setShowEulaModal(true);
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
      // Only ever used to backfill an empty console (fresh page load). If
      // lines are already showing, a stray/duplicate history replay must
      // never wipe them out from under the viewer.
      setConsoleLines((prev) => (prev.length > 0 ? prev : lines.map((l) => ({ ...l, historical: true } as ConsoleLine & { historical?: boolean }))));
    });

    socket.on('server:console', (msg: { data: string; type?: ConsoleLine['type']; timestamp?: number }) => {
      setConsoleLines((prev) => [...prev.slice(-500), {
        type: msg.type ?? 'output',
        data: msg.data,
        timestamp: msg.timestamp ?? Date.now(),
      }]);
    });

    // Wings clears its own log buffer on every fresh start — mirror that here
    // so a previous run's leftover output (a crash, a stuck install) doesn't
    // sit mixed in with the new run and read as if the old problem is still
    // happening.
    socket.on('server:console:clear', () => {
      setConsoleLines([]);
    });

    socket.on('server:players', (msg: { uuid: string; players: { name: string; uuid: string }[] }) => {
      if (msg.uuid === id) {
        setOnlinePlayers(msg.players);
        setPlayers({ online: msg.players.length, max: 0, names: msg.players.map((p) => p.name) });
      }
    });

    socket.on('server:alert', (msg: { severity: 'warning' | 'critical'; message: string }) => {
      if (msg.severity === 'critical') toast.error(msg.message, { icon: '🚨', duration: 8000 });
      else toast(msg.message, { icon: '⚠️', duration: 6000 });
    });

    return () => {
      socket.emit('server:unsubscribe', id);
      socket.disconnect();
    };
  }, [id, accessToken, queryClient]);

  useEffect(() => {
    if (autoScroll) consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLines, autoScroll]);

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
    const cmd = command.trim();
    if (!cmd || !socketRef.current) return;
    socketRef.current.emit('server:command', { serverId: id, command: cmd });
    // Record for ↑/↓ recall (dedupe consecutive repeats, cap at 50).
    setCmdHistory((h) => (h[h.length - 1] === cmd ? h : [...h, cmd]).slice(-50));
    historyIndexRef.current = -1;
    setCommand('');
  };

  // Type-ahead: commands (and prior history entries) whose name begins with
  // what's been typed so far. Only fires for a bare, still-being-typed command
  // word (no space yet) — once you're onto arguments there's nothing to
  // complete. On a non-Minecraft egg the built-in list is skipped and only the
  // server's own history drives suggestions.
  const getCommandSuggestions = (raw: string): string[] => {
    const token = raw.trimStart().toLowerCase();
    if (!token || token.includes(' ')) return [];
    const bare = token.startsWith('/') ? token.slice(1) : token;
    if (!bare) return [];
    const hist = cmdHistory.map((c) => c.trim()).filter((c) => { const l = c.toLowerCase(); return l.startsWith(bare) && l !== bare; });
    const known = isMinecraftEgg ? COMMON_MC_COMMANDS.filter((c) => c.startsWith(bare) && c !== bare) : [];
    return Array.from(new Set([...hist, ...known])).slice(0, 7);
  };

  const applySuggestion = (s: string) => {
    setCommand(s + ' ');
    setSuggestIndex(0);
    setSuggestDismissed(true);
    requestAnimationFrame(() => commandInputRef.current?.focus());
  };

  const onCommandKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const suggestions = suggestDismissed ? [] : getCommandSuggestions(command);

    // While the suggestion dropdown is open, the arrows/Tab drive it; Enter
    // still falls through to actually run the typed command.
    if (suggestions.length > 0) {
      if (e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(suggestions[Math.min(suggestIndex, suggestions.length - 1)]);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestIndex((i) => (i + 1) % suggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setSuggestDismissed(true);
      }
      return;
    }

    // No suggestions → ↑/↓ walk the command history like a real shell; ↓ past
    // the newest clears back to an empty prompt.
    if (e.key === 'ArrowUp') {
      if (cmdHistory.length === 0) return;
      e.preventDefault();
      const idx = historyIndexRef.current === -1 ? cmdHistory.length - 1 : Math.max(0, historyIndexRef.current - 1);
      historyIndexRef.current = idx;
      setCommand(cmdHistory[idx]);
    } else if (e.key === 'ArrowDown') {
      if (historyIndexRef.current === -1) return;
      e.preventDefault();
      const idx = historyIndexRef.current + 1;
      if (idx >= cmdHistory.length) { historyIndexRef.current = -1; setCommand(''); }
      else { historyIndexRef.current = idx; setCommand(cmdHistory[idx]); }
    }
  };

  // Strip ANSI escapes the same way the render does, so a copied log is clean
  // plain text rather than raw terminal control codes.
  const stripAnsi = (s: string) => (s || '').replace(/\x1b\[[0-9;]*[mGKHF]/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

  const copyConsole = () => {
    if (consoleLines.length === 0) return;
    navigator.clipboard.writeText(consoleLines.map((l) => stripAnsi(l.data)).join('\n'));
    toast.success('Console output copied');
  };

  const downloadConsole = () => {
    if (consoleLines.length === 0) return;
    const blob = new Blob([consoleLines.map((l) => stripAnsi(l.data)).join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data?.uuidShort || 'server'}-console-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onConsoleScroll = () => {
    const el = consoleScrollRef.current;
    if (!el) return;
    // Consider "at bottom" with a small slack so a line's own height doesn't
    // register as "scrolled up".
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };

  const jumpToLatest = () => {
    setAutoScroll(true);
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const sendPower = (action: string) => {
    if (!socketRef.current) return;
    if (action === 'start' && isMinecraftEgg && !isBedrock && !data?.eulaAccepted) {
      setShowEulaModal(true);
      return;
    }
    socketRef.current.emit('server:power', { serverId: id, action });
    toast.success(`Server ${action} command sent`);
  };

  const acceptEulaAndStart = async () => {
    setAcceptingEula(true);
    try {
      await api.post(`/servers/${id}/accept-eula`);
      queryClient.setQueryData(['server', id], (old: Server | undefined) => old ? { ...old, eulaAccepted: true } : old);
      setShowEulaModal(false);
      socketRef.current?.emit('server:power', { serverId: id, action: 'start' });
      toast.success('EULA accepted — starting server');
    } catch {
      toast.error('Failed to accept EULA');
    } finally {
      setAcceptingEula(false);
    }
  };

  const declineEula = () => {
    setShowEulaModal(false);
    toast.error('EULA declined — the server cannot start until you accept the Minecraft EULA.');
  };

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    setIpCopied(true);
    toast.success('Address copied');
    setTimeout(() => setIpCopied(false), 1500);
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

  // Minecraft-only tabs/behavior (EULA gate, mods/plugins/worlds/map/leaderboard)
  // must not show up for non-Minecraft eggs like CS2, Rust, ARK, GMod, TShock.
  const isMinecraftEgg = data?.egg?.nest?.name === 'Minecraft';
  const MINECRAFT_ONLY_TABS: Tab[] = ['plugins', 'mods', 'modpacks', 'versions', 'worlds', 'map', 'leaderboard'];

  const serverMcVersion: string | undefined = (() => {
    try {
      const env = JSON.parse((data as unknown as { env?: string })?.env || '{}') as Record<string, string>;
      return env['MC_VERSION'] || undefined;
    } catch { return undefined; }
  })();

  // Compares dot-separated version strings numerically (e.g. "1.21.4" vs
  // "1.20.1") — good enough for Minecraft's versioning, avoids pulling in
  // a semver dependency for one comparison.
  const compareMcVersions = (a: string, b: string): number => {
    const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pa[i] || 0) - (pb[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  };
  const isDowngrade = !!(serverMcVersion && selectedVersion && compareMcVersions(selectedVersion, serverMcVersion) < 0);

  // Recent players widget: online players first (live from socket), then most
  // recently seen offline players — so the list doesn't go blank when everyone leaves.
  const recentPlayers = (() => {
    const onlineNames = new Set(onlinePlayers.map((p) => p.name));
    const history: PlayerHistoryEntry[] = allPlayersData?.players ?? [];
    const offlineRecent = history
      .filter((p) => !onlineNames.has(p.name))
      .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
    return [
      ...onlinePlayers.map((p) => ({ name: p.name, uuid: p.uuid, online: true })),
      ...offlineRecent.slice(0, 8).map((p) => ({ name: p.name, uuid: p.uuid, online: false })),
    ];
  })();

  // Raw CPU %, NOT capped at 100 — Docker's convention is 100% = one full core,
  // so a server allowed 2 cores can legitimately read up to 200%. Capping at
  // 100 was making every server look pinned at "100% / 1 core" regardless of
  // its real usage or limit.
  const cpuUsage = stats && !isNaN(stats.cpuAbsolute) ? stats.cpuAbsolute : 0;
  // The server's CPU allowance, same "100% = 1 core" unit; 0 means unlimited.
  const cpuLimit = data?.cpu && data.cpu > 0 ? data.cpu : 0;
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <div className={`h-3 w-3 rounded-full ${getServerStatusDot(currentStatus)}`} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-100">{data.name}</h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs font-mono text-slate-500">{data.uuidShort}</span>
              <span className={`text-xs ${getServerStatusBadge(currentStatus)}`}>
                {currentStatus}
              </span>
              {isBedrock && (
                <span className="badge badge-blue text-[10px] uppercase tracking-wide">Bedrock</span>
              )}
              {data.allocation && (() => {
                const address = (data.node as typeof data.node & { gameSubdomain?: string })?.gameSubdomain
                  ? `${data.uuidShort}.${(data.node as typeof data.node & { gameSubdomain?: string }).gameSubdomain}:${data.allocation.port}`
                  : `${data.allocation.ip}:${data.allocation.port}`;
                return (
                  <button
                    onClick={() => copyAddress(address)}
                    className="flex items-center gap-1.5 text-xs font-mono text-slate-400 bg-dark-800/60 hover:bg-dark-700 hover:text-slate-200 px-1.5 py-0.5 rounded transition-colors group"
                    title="Copy address"
                  >
                    {address}
                    {ipCopied ? (
                      <CheckCircle2 size={12} className="text-green-400" />
                    ) : (
                      <Copy size={12} className="opacity-50 group-hover:opacity-100" />
                    )}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Power controls */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
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
            value={cpuLimit > 0 ? `${cpuUsage.toFixed(0)}% / ${cpuLimit}%` : `${cpuUsage.toFixed(0)}%`}
            percent={cpuLimit > 0 ? (cpuUsage / cpuLimit) * 100 : Math.min(cpuUsage, 100)}
            color="panel"
          />
          <MiniStat
            icon={<MemoryStick size={14} />}
            label="Memory"
            value={`${formatBytes(stats.memoryBytes)} / ${formatBytes(stats.memoryLimitBytes)}`}
            percent={memUsage}
            color="violet"
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

      {/* Install / reinstall progress banner — Pterodactyl-style. While Wings
          runs the egg's install script the server can't be used yet; make that
          state obvious (the install log itself streams into the console tab
          below). The page already polls every 3s in this state, so it flips to
          the normal view automatically once the install finishes. */}
      {(currentStatus === 'INSTALLING' || currentStatus === 'REINSTALLING') && (
        <div className="flex items-center gap-3 rounded-xl border border-panel-500/30 bg-panel-500/[0.07] px-4 py-3">
          <Spinner size="sm" className="text-panel-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">
              {currentStatus === 'REINSTALLING' ? 'Reinstalling your server…' : 'Your server is being installed…'}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              This can take a few minutes. You can watch the progress in the console below — the panel will unlock automatically when it's done.
            </p>
          </div>
        </div>
      )}
      {currentStatus === 'INSTALL_FAILED' && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.07] px-4 py-3">
          <AlertTriangle size={18} className="text-red-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Installation failed</p>
            <p className="text-xs text-slate-400 mt-0.5">
              The install script didn't finish cleanly. Check the console output below, then ask an admin to reinstall the server.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-dark-800 overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {TAB_GROUPS.map((group, gi) => {
            const visibleTabs = isMinecraftEgg
              ? group.tabs
              : group.tabs.filter(({ id }) => !MINECRAFT_ONLY_TABS.includes(id));
            if (visibleTabs.length === 0) return null;
            return (
            <div key={group.label} className="flex items-center gap-1">
              {gi > 0 && <span className="mx-1.5 h-5 w-px bg-dark-700" />}
              {visibleTabs.map(({ id: tab, label, icon: Icon }) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    'flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                    activeTab === tab
                      ? 'border-panel-500 text-panel-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  )}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
            );
          })}
        </div>
      </div>

      {/* Console Tab */}
      {activeTab === 'console' && (
        <div className="flex gap-4">
          <div className="card flex-1 min-w-0 overflow-hidden flex flex-col" style={{ background: '#0a0d12' }}>
            {/* Terminal title bar */}
            <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-dark-800" style={{ background: '#0e1116' }}>
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
              <span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
              <div className="ml-2 flex items-center gap-1.5">
                <Terminal size={12} className="text-slate-600" />
                <span className="text-[11px] font-mono text-slate-500">{data?.name || 'console'}</span>
              </div>
              {/* Live/offline pill */}
              <span
                className={cn(
                  'ml-3 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium',
                  isRunning ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-500/10 text-slate-500'
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', getServerStatusDot(currentStatus), isRunning && 'animate-pulse')} />
                {isRunning ? 'Live' : currentStatus.charAt(0) + currentStatus.slice(1).toLowerCase()}
              </span>

              {/* Toolbar */}
              <div className="ml-auto flex items-center gap-1">
                {/* Filter box — narrows the output to matching lines. */}
                <div className="relative mr-1 hidden sm:block">
                  <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                  <input
                    value={consoleSearch}
                    onChange={(e) => setConsoleSearch(e.target.value)}
                    placeholder="Filter…"
                    className="w-28 focus:w-40 transition-all bg-black/30 border border-dark-700 rounded-md pl-6 pr-2 py-1 text-[11px] font-mono text-slate-200 placeholder-slate-600 outline-none focus:border-panel-500/50"
                  />
                </div>
                <button
                  onClick={() => setShowTimestamps((v) => !v)}
                  title="Toggle timestamps"
                  className={cn('p-1.5 rounded-md transition-colors', showTimestamps ? 'text-panel-400 bg-panel-500/10' : 'text-slate-600 hover:text-slate-300 hover:bg-white/5')}
                >
                  <Clock size={13} />
                </button>
                <button
                  onClick={copyConsole}
                  title="Copy console output"
                  className="p-1.5 rounded-md text-slate-600 hover:text-slate-300 hover:bg-white/5 transition-colors"
                >
                  <Copy size={13} />
                </button>
                <button
                  onClick={downloadConsole}
                  title="Download log as .txt"
                  className="p-1.5 rounded-md text-slate-600 hover:text-slate-300 hover:bg-white/5 transition-colors"
                >
                  <Download size={13} />
                </button>
                <button
                  onClick={() => setConsoleLines([])}
                  title="Clear console"
                  className="p-1.5 rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Eraser size={13} />
                </button>
                <span className="ml-1 text-[10px] font-mono text-slate-700 tabular-nums">{consoleLines.length}</span>
              </div>
            </div>

            {/* Live resource strip — real-time CPU/RAM/disk/network/uptime/
                players from the socket stats feed. Dashes until the first
                sample arrives (or while the server is offline). */}
            <div className="flex items-stretch divide-x divide-dark-800 border-b border-dark-800" style={{ background: '#0c1015' }}>
              {[
                { icon: Cpu, label: 'CPU', value: stats ? `${stats.cpuAbsolute.toFixed(0)}%` : '—', sub: (data?.cpu || 0) > 0 ? `/ ${data?.cpu}%` : (stats ? '/ ∞' : '') },
                { icon: MemoryStick, label: 'RAM', value: stats ? formatBytes(stats.memoryBytes) : '—', sub: `/ ${formatBytes((data?.memory || 0) * 1048576)}` },
                { icon: HardDrive, label: 'Disk', value: stats ? formatBytes(stats.diskBytes) : '—', sub: (data?.disk || 0) > 0 ? `/ ${formatBytes((data?.disk || 0) * 1048576)}` : '' },
                { icon: Wifi, label: 'Network', value: stats ? `↓ ${formatBytes(stats.networkRxBytes)}` : '—', sub: stats ? `↑ ${formatBytes(stats.networkTxBytes)}` : '' },
                { icon: Clock, label: 'Uptime', value: stats && stats.uptime > 0 ? formatUptime(Math.floor(stats.uptime / 1000)) : '—', sub: '' },
                { icon: Users, label: 'Players', value: `${onlinePlayers.length}`, sub: players.max ? `/ ${players.max}` : '' },
              ].map(({ icon: Icon, label, value, sub }) => (
                <div key={label} className="flex-1 min-w-0 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-slate-600 mb-1">
                    <Icon size={11} />
                    <span className="text-[9px] uppercase tracking-wider">{label}</span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-200 truncate">
                    {value} {sub && <span className="text-slate-600">{sub}</span>}
                  </div>
                </div>
              ))}
            </div>

            {/* Output */}
            <div className="relative flex-1">
              <div
                ref={consoleScrollRef}
                onScroll={onConsoleScroll}
                className="p-4 h-96 overflow-y-auto font-mono text-xs scrollbar-none leading-relaxed"
              >
                {consoleLines.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-700 gap-2">
                    <Terminal size={28} className="opacity-40" />
                    <p className="italic">{isRunning ? 'Waiting for output…' : 'Server is offline — start it to see live output'}</p>
                  </div>
                ) : (() => {
                  const q = consoleSearch.trim().toLowerCase();
                  const shown = q ? consoleLines.filter((l) => stripAnsi(l.data).toLowerCase().includes(q)) : consoleLines;
                  if (shown.length === 0) {
                    return <div className="h-full flex items-center justify-center text-slate-700 italic">No lines match “{consoleSearch}”</div>;
                  }
                  return shown.map((line, i) => {
                    const text = stripAnsi(line.data);
                    const isError = /\b(error|exception|fatal|severe)\b/i.test(text);
                    const isWarn = /\b(warn|warning)\b/i.test(text);
                    return (
                      <div key={i} className="group flex gap-2 -mx-1 px-1 rounded hover:bg-white/[0.025]">
                        {showTimestamps && (
                          <span className="shrink-0 text-slate-700 tabular-nums select-none">
                            {new Date(line.timestamp).toLocaleTimeString([], { hour12: false })}
                          </span>
                        )}
                        <span
                          className={cn(
                            'whitespace-pre-wrap break-all min-w-0',
                            line.type === 'input'
                              ? 'text-yellow-300/90'
                              : isError
                                ? 'text-red-400/90'
                                : isWarn
                                  ? 'text-amber-400/85'
                                  : 'text-emerald-300/80'
                          )}
                        >
                          {line.type === 'input' && <span className="text-slate-600 select-none">&gt; </span>}
                          {text}
                        </span>
                      </div>
                    );
                  });
                })()}
                <div ref={consoleEndRef} />
              </div>

              {/* Jump-to-latest — only while scrolled up */}
              {!autoScroll && consoleLines.length > 0 && (
                <button
                  onClick={jumpToLatest}
                  className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium bg-panel-500 text-white shadow-lg shadow-black/40 hover:bg-panel-400 transition-colors"
                >
                  <ArrowDown size={12} /> Latest
                </button>
              )}
            </div>

            {/* Command input + type-ahead suggestions */}
            <div className="relative border-t border-dark-800" style={{ background: '#0e1116' }}>
              {(() => {
                const suggestions = suggestDismissed ? [] : getCommandSuggestions(command);
                if (suggestions.length === 0) return null;
                const active = Math.min(suggestIndex, suggestions.length - 1);
                return (
                  <div className="absolute bottom-full left-3 right-3 mb-1 rounded-lg border border-dark-700 overflow-hidden shadow-xl shadow-black/50" style={{ background: '#12161c' }}>
                    {suggestions.map((s, i) => (
                      <button
                        key={s}
                        type="button"
                        onMouseEnter={() => setSuggestIndex(i)}
                        onClick={() => applySuggestion(s)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-1.5 text-left font-mono text-xs transition-colors',
                          i === active ? 'bg-panel-500/15 text-panel-200' : 'text-slate-400 hover:bg-white/5'
                        )}
                      >
                        <Terminal size={11} className="text-slate-600 shrink-0" />
                        <span className="flex-1 truncate">{s}</span>
                        {i === active && <kbd className="text-[9px] text-slate-600 border border-dark-700 rounded px-1">Tab</kbd>}
                      </button>
                    ))}
                  </div>
                );
              })()}
              <form onSubmit={sendCommand} className="flex items-center gap-2 px-3 py-3">
                <span className="flex items-center text-emerald-400 font-mono text-sm pl-1 select-none">$</span>
                <input
                  ref={commandInputRef}
                  type="text"
                  className="flex-1 bg-transparent outline-none font-mono text-sm text-slate-100 placeholder-slate-600 disabled:opacity-50"
                  placeholder={isRunning ? 'Type a command…  (Tab to complete · ↑/↓ history)' : 'Start the server to send commands'}
                  value={command}
                  onChange={(e) => { setCommand(e.target.value); setSuggestDismissed(false); setSuggestIndex(0); historyIndexRef.current = -1; }}
                  onKeyDown={onCommandKeyDown}
                  disabled={!isRunning}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="submit" className="btn-primary btn-sm" disabled={!isRunning || !command.trim()}>
                  Send
                </button>
              </form>
            </div>
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
              {recentPlayers.length === 0 ? (
                <p className="text-xs text-slate-600">No players seen yet</p>
              ) : (
                recentPlayers.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => !isBedrock && openInventory(p)}
                    className={cn(
                      'flex items-center gap-2 w-full px-2 py-1.5 rounded-lg border transition-all group',
                      p.online ? 'bg-dark-700 border-dark-600' : 'bg-dark-800/40 border-dark-800',
                      isBedrock ? 'cursor-default' : 'hover:bg-dark-600 hover:border-panel-500/40'
                    )}
                    title={isBedrock ? p.name : p.online ? 'Click to view inventory' : `${p.name} (offline) — click to view inventory`}
                  >
                    <span className="relative shrink-0">
                      <img
                        src={`https://mc-heads.net/avatar/${p.name}/24`}
                        alt={p.name}
                        className={cn('w-6 h-6 rounded pixelated', !p.online && 'opacity-50')}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <span className={cn(
                        'absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-dark-900',
                        p.online ? 'bg-green-400' : 'bg-slate-600'
                      )} />
                    </span>
                    <span className={cn(
                      'text-xs font-medium flex-1 text-left truncate',
                      p.online ? 'text-slate-300 group-hover:text-slate-100' : 'text-slate-500'
                    )}>{p.name}</span>
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
        <>
          {data?.node && user?.username && (
            <div className="card mb-4 p-4">
              <div className="flex items-center gap-2 mb-3">
                <KeyRound size={14} className="text-brand-400" />
                <h3 className="text-sm font-semibold text-slate-200">SFTP Access</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                {[
                  // Same source as the connection address shown in the server
                  // header (data.allocation.ip) — the node's own fqdn can be
                  // set to something only reachable from the node itself
                  // (e.g. 127.0.0.1), while the allocation is this server's
                  // actual public-facing address.
                  { label: 'Host', value: data.allocation?.ip || data.node.fqdn },
                  { label: 'Port', value: String(data.node.daemonSftp ?? 2022) },
                  { label: 'Username', value: `${user.username}.${data.uuidShort}` },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-dark-950 border border-slate-700/50 rounded-lg px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">{label}</p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-slate-300 truncate">{value}</span>
                      <button
                        className="text-slate-500 hover:text-slate-300 shrink-0"
                        onClick={() => { navigator.clipboard.writeText(value); toast.success(`${label} copied`); }}
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="bg-dark-950 border border-slate-700/50 rounded-lg px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Password</p>
                  {/* There's no separate SFTP password to show or copy — the
                      panel only ever stores a bcrypt hash of your account
                      password, never the password itself, so it can't be
                      displayed here even to you. */}
                  <span className="text-xs text-slate-400">Your panel password</span>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-3">
                Connect with any SFTP client using your panel password — there's no separate SFTP credential to set up. Access is scoped to this server's files only.
              </p>
            </div>
          )}
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
        </>
      )}

      {/* Plugins Tab */}
      {activeTab === 'plugins' && (
        <PluginManager serverId={id!} mcVersion={serverMcVersion} />
      )}

      {/* Mods Tab */}
      {activeTab === 'mods' && (
        <ModManager serverId={id!} mcVersion={serverMcVersion} eggName={data.egg?.name} />
      )}

      {activeTab === 'modpacks' && (
        <ModpackManager serverId={id!} serverStatus={currentStatus} onInstalled={() => refetch()} />
      )}

      {/* Versions Tab */}
      {activeTab === 'versions' && (
        <div className="card card-body space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-100 mb-1">Paper Version Manager</h3>
            <p className="text-xs text-slate-500">
              Download and install a specific Paper version. Stop the server before changing versions.
              {serverMcVersion && <span className="ml-1">Currently installed: <span className="font-mono text-slate-400">{serverMcVersion}</span>.</span>}
            </p>
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
                {builds.map((b) => <option key={b.id} value={b.id}>#{b.id} — {new Date(b.time).toLocaleDateString()}</option>)}
              </select>
            </div>

            <div className="flex items-end">
              <button
                className="btn-primary w-full"
                disabled={!selectedVersion || installing_version || currentStatus !== 'OFFLINE' || (isDowngrade && !downgradeConfirmed)}
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

          {/* Changelog for the selected build */}
          {(() => {
            const build = selectedBuild === 'latest' ? builds[0] : builds.find((b) => b.id === selectedBuild);
            if (!build || build.commits.length === 0) return null;
            return (
              <div>
                <p className="text-xs font-medium text-slate-400 mb-1.5">Changes in build #{build.id}</p>
                <div className="rounded-lg bg-dark-800/60 border border-dark-800 divide-y divide-dark-800 max-h-40 overflow-y-auto">
                  {build.commits.map((c) => (
                    <div key={c.sha} className="px-3 py-2">
                      <p className="text-xs text-slate-300">{c.message.split('\n')[0]}</p>
                      <p className="text-[10px] text-slate-600 font-mono mt-0.5">{c.sha.slice(0, 7)} · {new Date(c.time).toLocaleDateString()}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {currentStatus !== 'OFFLINE' && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs">
              <Square size={13} />
              Stop the server before changing versions.
            </div>
          )}

          {isDowngrade && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span>
                  <strong>This is a downgrade</strong> (installed: {serverMcVersion} → target: {selectedVersion}). If the
                  world has already been opened on a newer version, downgrading corrupts chunk data and can crash the
                  server. Back up first.
                </span>
              </div>
              <label className="flex items-center gap-2 px-1 cursor-pointer">
                <input type="checkbox" checked={downgradeConfirmed} onChange={(e) => setDowngradeConfirmed(e.target.checked)} className="accent-red-500" />
                <span className="text-xs text-slate-400">I understand the risk and want to downgrade anyway</span>
              </label>
            </div>
          )}

          <label className="flex items-center gap-2 px-1 cursor-pointer">
            <input type="checkbox" checked={backupBeforeInstall} onChange={(e) => setBackupBeforeInstall(e.target.checked)} className="accent-panel-500" />
            <span className="text-xs text-slate-400">Create a backup before installing</span>
          </label>

          <div className="flex items-center gap-2 p-3 rounded-lg bg-dark-800/60 text-slate-500 text-xs">
            <Tag size={13} />
            After installing, start the server — Paper will automatically remap and launch with the new version.
          </div>
        </div>
      )}

      {/* Worlds Tab */}
      {activeTab === 'worlds' && (
        <WorldManager serverId={id!} />
      )}

      {/* Map Tab */}
      {activeTab === 'map' && (
        <WorldMapViewer serverId={id!} />
      )}

      {/* Stats Tab */}
      {activeTab === 'stats' && (
        <div className="space-y-4">
          {healthData && <HealthScoreCard score={healthData.score} factors={healthData.factors} /> }

          {/* Resource Sparklines */}
          <div className="card card-body">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Resource Usage (last 2 minutes)</h3>
            <StatsSparklines history={(statsHistory?.data ?? []) as StatsHistoryPoint[]} />
            <div className="flex gap-4 mt-3 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-green-400 rounded" /> CPU %</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-blue-400 rounded" /> RAM %</span>
            </div>
          </div>

          {/* Long-range history (persisted, survives restarts) */}
          <div className="card card-body">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-300">History</h3>
              <div className="flex gap-1 rounded-lg bg-dark-800 p-1">
                {(['1h', '24h', '7d'] as const).map((r) => (
                  <button
                    key={r}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${historyRange === r ? 'bg-panel-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    onClick={() => setHistoryRange(r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <StatsHistoryChart history={(longStatsHistory?.data ?? []) as StatsHistoryPoint[]} />
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

      {activeTab === 'leaderboard' && (() => {
        const players: LeaderboardEntry[] = leaderboardData?.players ?? [];
        const sorted = [...players].sort((a, b) => b[leaderboardSort] - a[leaderboardSort]);
        const medalFor = (rank: number) => rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : null;
        return (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-dark-800/50 border border-dark-700 text-slate-500 text-xs">
              <Trophy size={14} className="shrink-0 mt-0.5" />
              <span>Read straight from each player's Minecraft stats file — playtime, kills, deaths, and more, ranked across everyone who's ever joined this server.</span>
            </div>
            <div className="card">
              <div className="card-header flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-sm font-semibold text-slate-100">Leaderboard</h3>
                <div className="flex items-center gap-1 flex-wrap">
                  {LEADERBOARD_COLUMNS.map((col) => (
                    <button
                      key={col.key}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                        leaderboardSort === col.key ? 'bg-panel-600 text-white' : 'bg-dark-800 text-slate-400 hover:text-slate-200'
                      )}
                      onClick={() => setLeaderboardSort(col.key)}
                    >
                      {col.label}
                    </button>
                  ))}
                </div>
              </div>
              {leaderboardLoading ? (
                <div className="flex justify-center py-12"><Spinner /></div>
              ) : sorted.length === 0 ? (
                <div className="p-10 text-center text-slate-500">
                  <Trophy size={28} className="mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No player stats yet — they show up here once someone's played a bit</p>
                </div>
              ) : (
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>#</th><th>Player</th><th>Playtime</th><th>Mob Kills</th>
                        <th>Player Kills</th><th>Deaths</th><th>Blocks Mined</th><th>Jumps</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((p, i) => (
                        <tr key={p.uuid}>
                          <td className="text-slate-500 font-mono text-xs w-10">{medalFor(i) ?? i + 1}</td>
                          <td>
                            <div className="flex items-center gap-2.5">
                              <img src={`https://mc-heads.net/avatar/${p.name}/32`} alt="" className="w-7 h-7 rounded pixelated shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                              <span className="font-medium text-slate-200">{p.name}</span>
                            </div>
                          </td>
                          <td className={leaderboardSort === 'playTimeTicks' ? 'text-panel-400 font-semibold' : 'text-slate-300'}>{formatPlaytime(p.playTimeTicks)}</td>
                          <td className={leaderboardSort === 'mobKills' ? 'text-panel-400 font-semibold' : 'text-slate-300'}>{p.mobKills.toLocaleString()}</td>
                          <td className={leaderboardSort === 'playerKills' ? 'text-panel-400 font-semibold' : 'text-slate-300'}>{p.playerKills.toLocaleString()}</td>
                          <td className={leaderboardSort === 'deaths' ? 'text-panel-400 font-semibold' : 'text-slate-300'}>{p.deaths.toLocaleString()}</td>
                          <td className={leaderboardSort === 'blocksMinedTotal' ? 'text-panel-400 font-semibold' : 'text-slate-300'}>{p.blocksMinedTotal.toLocaleString()}</td>
                          <td className={leaderboardSort === 'jumps' ? 'text-panel-400 font-semibold' : 'text-slate-300'}>{p.jumps.toLocaleString()}</td>
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
                        {task.enabled && task.nextRun && (
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            Next: {new Date(task.nextRun).toLocaleString()}
                          </span>
                        )}
                        {task.lastRun && (
                          <span className="flex items-center gap-1 text-slate-600">
                            Last ran: {new Date(task.lastRun).toLocaleString()}
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

      {activeTab === 'customize' && (
        <PublicPageCustomizer serverId={id!} server={data} />
      )}

      {activeTab === 'settings' && (
        <div className="space-y-4">
          <div className="card">
            <div className="card-header flex items-center gap-2">
              <SettingsIcon size={14} className="text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-100">Server Behavior</h3>
            </div>
            <div className="p-5 space-y-3">
              <label className="flex items-start gap-3 p-3 rounded-lg border border-dark-700 bg-dark-800/40 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={crashDetectionEnabled}
                  onChange={(e) => setCrashDetectionEnabled(e.target.checked)}
                />
                <span>
                  <span className="flex items-center gap-1.5 text-sm text-slate-200"><RotateCw size={13} /> Auto-restart on crash</span>
                  <span className="block text-xs text-slate-500 mt-0.5">
                    If the server process exits unexpectedly, it's restarted automatically (up to 3 times within 10 minutes, to avoid a boot loop). Takes effect on next start.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-lg border border-dark-700 bg-dark-800/40 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={autoOptimizeEnabled}
                  onChange={(e) => setAutoOptimizeEnabled(e.target.checked)}
                />
                <span>
                  <span className="flex items-center gap-1.5 text-sm text-slate-200"><Gauge size={13} /> Auto-optimize on lag spikes</span>
                  <span className="block text-xs text-slate-500 mt-0.5">
                    If CPU stays above 90% (or memory above 95%) for a sustained minute, dropped-item lag is cleared automatically and logged to Activity. At most once every 5 minutes.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-lg border border-dark-700 bg-dark-800/40 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={publicStatusEnabled}
                  onChange={(e) => setPublicStatusEnabled(e.target.checked)}
                />
                <span>
                  <span className="flex items-center gap-1.5 text-sm text-slate-200"><Globe2 size={13} /> Public status page</span>
                  <span className="block text-xs text-slate-500 mt-0.5">
                    A shareable, no-login page showing online/offline, player count, and how to join — safe to post in Discord or on a website.
                  </span>
                  {publicStatusEnabled && data?.publicSlug && (
                    <div className="flex items-center gap-2 mt-2">
                      <code className="text-xs px-2 py-1 rounded bg-dark-900 text-panel-400 truncate">{`${window.location.origin}/status/${data.publicSlug}`}</code>
                      <button
                        type="button"
                        className="p-1 text-slate-500 hover:text-slate-300"
                        onClick={(e) => {
                          e.preventDefault();
                          navigator.clipboard.writeText(`${window.location.origin}/status/${data.publicSlug}`);
                          toast.success('Link copied');
                        }}
                      >
                        <Copy size={13} />
                      </button>
                      <a
                        href={`/status/${data.publicSlug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 text-slate-500 hover:text-slate-300"
                        title="Open public page"
                      >
                        <ExternalLink size={13} />
                      </a>
                    </div>
                  )}

                  {publicStatusEnabled && (
                    <div className="mt-3 pt-3 border-t border-dark-700">
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-xs font-medium text-panel-400 hover:text-panel-300"
                        onClick={(e) => { e.preventDefault(); setActiveTab('customize'); }}
                      >
                        <Palette size={12} /> Customize the look (logo, banner, colors, custom CSS) →
                      </button>
                    </div>
                  )}
                </span>
              </label>
              <div className="flex justify-end pt-1">
                <button className="btn-primary btn-sm" onClick={saveServerSettings} disabled={savingSettings}>
                  {savingSettings ? <Spinner size="sm" /> : <><Save size={13} /> Save</>}
                </button>
              </div>
            </div>
          </div>

          {siteSettings?.['discord.configured'] === 'true' && (
            <div className="card">
              <div className="card-header flex items-center gap-2">
                <Bot size={14} className="text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-100">Discord Bot</h3>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-xs text-slate-500">
                  Link a Discord channel to this server so <code className="text-panel-400">/start</code>, <code className="text-panel-400">/stop</code>,{' '}
                  <code className="text-panel-400">/restart</code>, and <code className="text-panel-400">/status</code> work right from Discord.
                </p>
                <ol className="text-xs text-slate-500 list-decimal list-inside space-y-1">
                  <li>Generate a code below (valid for 10 minutes).</li>
                  <li>In the Discord channel you want to control this server from, run <code className="text-panel-400">/bind &lt;code&gt;</code>.</li>
                </ol>
                {discordBindCode ? (
                  <div className="flex items-center gap-2">
                    <code className="text-sm px-3 py-1.5 rounded bg-dark-900 text-panel-400 font-mono tracking-wider">{discordBindCode}</code>
                    <button
                      type="button"
                      className="p-1.5 text-slate-500 hover:text-slate-300"
                      onClick={() => { navigator.clipboard.writeText(discordBindCode); toast.success('Code copied'); }}
                    >
                      <Copy size={13} />
                    </button>
                    <button type="button" className="btn-secondary btn-sm" onClick={generateDiscordBindCode} disabled={generatingBindCode}>
                      {generatingBindCode ? <Spinner size="sm" /> : 'Regenerate'}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="btn-secondary btn-sm" onClick={generateDiscordBindCode} disabled={generatingBindCode}>
                    {generatingBindCode ? <Spinner size="sm" /> : <><Bot size={13} /> Generate Bind Code</>}
                  </button>
                )}
              </div>
            </div>
          )}
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

      {/* EULA acceptance modal — asked of the server owner on first start */}
      {showEulaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={declineEula}>
          <div className="bg-dark-800 border border-dark-600 rounded-xl w-full max-w-md mx-4 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-100 mb-2">Accept the Minecraft EULA</h3>
            <p className="text-sm text-slate-400 mb-4">
              Before this server can start for the first time, you (the server owner) need to accept the{' '}
              <a href="https://www.minecraft.net/en-us/eula" target="_blank" rel="noopener noreferrer" className="text-panel-400 hover:underline">
                Minecraft End User License Agreement
              </a>.
            </p>
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={declineEula}>Decline</button>
              <button className="btn-primary flex-1" onClick={acceptEulaAndStart} disabled={acceptingEula}>
                {acceptingEula ? <Spinner size="sm" /> : 'Accept'}
              </button>
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

// Community-mirrored copy of Mojang's own item textures, keyed by the plain
// (no "minecraft:" prefix) item id — the same id format Wings already
// returns for inventory NBT. Falls back to a color-coded initial badge
// (getItemStyle) for anything that 404s, e.g. modded items.
const MC_ICON_BASE = 'https://mcasset.cloud/1.21.4/assets/minecraft/textures/item';

function MCItemIcon({ id, size = 28 }: { id: string; size?: number }) {
  const { bg, fg } = getItemStyle(id);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className="w-full h-full rounded-sm flex items-center justify-center"
        style={{ background: bg }}
      >
        <span className="text-[7px] font-bold select-none" style={{ color: fg }}>{itemAbbr(id)}</span>
      </div>
    );
  }
  return (
    <img
      src={`${MC_ICON_BASE}/${id}.png`}
      alt={id}
      width={size}
      height={size}
      className="select-none pointer-events-none"
      style={{ imageRendering: 'pixelated' }}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

function MCSlot({ item, onDelete, emptyIcon }: { item?: NbtItem; onDelete?: (slot: number) => void; emptyIcon?: string }) {
  if (!item) {
    return (
      <div
        className="w-10 h-10 rounded-sm flex-shrink-0 flex items-center justify-center"
        style={{ background: '#1a2030', border: '1px solid #0d1520', boxShadow: 'inset 1px 1px 0 rgba(0,0,0,0.6), inset -1px -1px 0 rgba(255,255,255,0.04)' }}
      >
        {emptyIcon && <div className="w-6 h-6 opacity-30"><MCItemIcon id={emptyIcon} size={24} /></div>}
      </div>
    );
  }
  return (
    <div
      className="relative group flex-shrink-0 cursor-default"
      title={`${item.id.replace(/_/g, ' ')} ×${item.count}  [slot ${item.slot}]`}
    >
      <div
        className="w-10 h-10 rounded-sm flex items-center justify-center relative overflow-hidden transition-colors group-hover:bg-white/[0.08]"
        style={{ background: '#1a2030', border: '1px solid #2a3550', boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.07), inset -1px -1px 0 rgba(0,0,0,0.5)' }}
      >
        <MCItemIcon id={item.id} size={28} />
        {item.count > 1 && (
          <span className="absolute bottom-0 right-0.5 text-[9px] font-bold leading-none select-none"
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
  const armorSlots = [39, 38, 37, 36]; // helmet → boots
  const armorEmptyIcons = ['empty_armor_slot_helmet', 'empty_armor_slot_chestplate', 'empty_armor_slot_leggings', 'empty_armor_slot_boots'];
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
        <div className="flex gap-0.5 mb-0.5 items-center">
          {armorSlots.map((s, i) => (
            <MCSlot key={s} item={slotMap.get(s)} onDelete={onDelete} emptyIcon={armorEmptyIcons[i]} />
          ))}
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
    panel: 'bg-panel-500', violet: 'bg-[#A78BFA]', green: 'bg-[#3EC896]', orange: 'bg-[#F0954D]',
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

function HealthScoreCard({ score, factors }: { score: number; factors: { label: string; delta: number }[] }) {
  const color = score >= 85 ? 'text-green-400' : score >= 60 ? 'text-yellow-400' : 'text-red-400';
  const ring = score >= 85 ? '#4ade80' : score >= 60 ? '#facc15' : '#f87171';
  const label = score >= 85 ? 'Healthy' : score >= 60 ? 'Needs attention' : 'At risk';
  const circumference = 2 * Math.PI * 26;
  const offset = circumference * (1 - score / 100);

  return (
    <div className="card card-body flex items-center gap-5 flex-wrap">
      <div className="relative shrink-0" style={{ width: 64, height: 64 }}>
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="26" fill="none" stroke="#1e293b" strokeWidth="6" />
          <circle
            cx="32" cy="32" r="26" fill="none" stroke={ring} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={offset}
            transform="rotate(-90 32 32)" style={{ transition: 'stroke-dashoffset 0.6s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn('text-base font-bold', color)}>{score}</span>
        </div>
      </div>
      <div className="flex-1 min-w-[200px]">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-100">Health Score</h3>
          <span className={cn('text-xs font-medium', color)}>{label}</span>
        </div>
        {factors.length === 0 ? (
          <p className="text-xs text-slate-500 mt-1">No issues detected in the last 7 days — crashes, lag spikes, and backup freshness all look good.</p>
        ) : (
          <ul className="mt-1.5 space-y-0.5">
            {factors.map((f, i) => (
              <li key={i} className="text-xs text-slate-500 flex items-center gap-1.5">
                <span className="text-red-400 font-mono w-8 shrink-0">{f.delta}</span>
                {f.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatsHistoryChart({ history }: { history: StatsHistoryPoint[] }) {
  if (!history || history.length < 2) {
    return (
      <div className="flex items-center justify-center h-56 text-slate-600 text-xs rounded-lg" style={{ background: '#0b0f14' }}>
        Not enough history yet — check back in a few minutes
      </div>
    );
  }

  const points = history.map((p) => ({
    time: typeof p.timestamp === 'number' ? p.timestamp : new Date(p.timestamp).getTime(),
    cpu: Math.max(0, p.cpuAbsolute ?? 0),
    ramPct: p.memoryLimitBytes > 0 ? Math.min((p.memoryBytes / p.memoryLimitBytes) * 100, 100) : 0,
  }));

  // Let the axis grow past 100 so a multi-core server (CPU can read 200%+ since
  // 100% = one core) isn't clipped; rounds up to the next whole core.
  const peakCpu = Math.max(100, ...points.map((p) => p.cpu));
  const yMax = Math.ceil(peakCpu / 100) * 100;
  const yTicks = Array.from({ length: yMax / 100 + 1 }, (_, i) => i * 100);

  const span = points[points.length - 1].time - points[0].time;
  const formatTick = (t: number) =>
    span > 20 * 60 * 60 * 1000
      ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <ResponsiveContainer width="100%" height={224}>
      <AreaChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#4ade80" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#4ade80" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="ramGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="time" type="number" domain={['dataMin', 'dataMax']}
          tickFormatter={formatTick} stroke="#475569" fontSize={10} tickLine={false} axisLine={false}
        />
        <YAxis domain={[0, yMax]} ticks={yTicks} stroke="#475569" fontSize={10} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v}%`} />
        <Tooltip
          contentStyle={{ background: '#0f1520', border: '1px solid #1e293b', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: '#94a3b8' }}
          labelFormatter={(t: number) => new Date(t).toLocaleString()}
          formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, name === 'cpu' ? 'CPU' : 'RAM']}
        />
        <Area type="monotone" dataKey="cpu" name="cpu" stroke="#4ade80" fill="url(#cpuGradient)" strokeWidth={1.5} isAnimationActive={false} />
        <Area type="monotone" dataKey="ramPct" name="ramPct" stroke="#60a5fa" fill="url(#ramGradient)" strokeWidth={1.5} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
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

  // Scale CPU to its own peak-core ceiling (100% = one core) so a multi-core
  // server's line fits the 0–100 plot area and keeps its true shape, instead
  // of flat-lining at a hard 100% cap.
  const cpuScaleMax = Math.ceil(Math.max(100, ...history.map((p) => p.cpuAbsolute ?? 0)) / 100) * 100;
  const cpuVals = history.map((p) => ((p.cpuAbsolute ?? 0) / cpuScaleMax) * 100);
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
