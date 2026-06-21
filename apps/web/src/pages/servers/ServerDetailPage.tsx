import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Play, Square, RotateCcw, Zap, Terminal, BarChart2,
  HardDrive, Archive, ChevronLeft, Cpu, MemoryStick
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

type Tab = 'console' | 'stats' | 'backups';

interface ConsoleLine {
  type: 'output' | 'input' | 'status';
  data: string;
  timestamp: number;
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

  const { data: backupsData } = useQuery({
    queryKey: ['server-backups', id],
    queryFn: () => api.get(`/servers/${id}/backups`).then((r) => r.data.data),
    enabled: activeTab === 'backups' && !!id,
  });

  useEffect(() => {
    if (data) setCurrentStatus(data.status);
  }, [data]);

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

    socket.on('server:status', ({ status }: { status: ServerStatus }) => {
      setCurrentStatus(status);
      queryClient.setQueryData(['server', id], (old: Server | undefined) =>
        old ? { ...old, status } : old
      );
    });

    socket.on('server:stats', (statsData: ServerStats) => {
      setStats(statsData);
    });

    socket.on('server:console', (line: ConsoleLine) => {
      setConsoleLines((prev) => [...prev.slice(-500), line]);
    });

    return () => {
      socket.emit('server:unsubscribe', id);
      socket.disconnect();
    };
  }, [id, accessToken, queryClient]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLines]);

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

  const cpuUsage = stats ? Math.min(stats.cpuAbsolute, 100) : 0;
  const memUsage = stats ? (stats.memoryBytes / stats.memoryLimitBytes) * 100 : 0;

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
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs font-mono text-slate-500">{data.uuidShort}</span>
              <span className={`text-xs ${getServerStatusBadge(currentStatus)}`}>
                {currentStatus}
              </span>
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
      {stats && isRunning && (
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
          {(['console', 'stats', 'backups'] as Tab[]).map((tab) => (
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
              {tab === 'stats' && <BarChart2 size={14} className="inline mr-1.5" />}
              {tab === 'backups' && <Archive size={14} className="inline mr-1.5" />}
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Console Tab */}
      {activeTab === 'console' && (
        <div className="card">
          <div
            className="bg-dark-1000 rounded-t-xl p-4 h-96 overflow-y-auto font-mono text-xs scrollbar-none"
            style={{ background: '#0d1117' }}
          >
            {consoleLines.length === 0 ? (
              <p className="text-slate-600">Waiting for output...</p>
            ) : (
              consoleLines.map((line, i) => (
                <p
                  key={i}
                  className={cn(
                    'leading-relaxed whitespace-pre-wrap break-all',
                    line.type === 'input' ? 'text-yellow-300' : 'text-green-300/90'
                  )}
                >
                  {line.data}
                </p>
              ))
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
              <InfoRow label="Allocation" value={data.allocation ? `${data.allocation.ip}:${data.allocation.port}` : '-'} />
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
