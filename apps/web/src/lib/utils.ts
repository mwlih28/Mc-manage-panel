import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ServerStatus } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function getServerStatusColor(status: ServerStatus): string {
  const colors: Record<ServerStatus, string> = {
    RUNNING: 'text-green-400',
    STARTING: 'text-yellow-400',
    STOPPING: 'text-orange-400',
    OFFLINE: 'text-slate-400',
    INSTALLING: 'text-blue-400',
    INSTALL_FAILED: 'text-red-400',
    REINSTALLING: 'text-blue-400',
    SUSPENDED: 'text-red-400',
    RESTORING_BACKUP: 'text-purple-400',
    UNKNOWN: 'text-slate-500',
  };
  return colors[status] || 'text-slate-400';
}

export function getServerStatusBadge(status: ServerStatus): string {
  const badges: Record<ServerStatus, string> = {
    RUNNING: 'badge-green',
    STARTING: 'badge-yellow',
    STOPPING: 'badge-yellow',
    OFFLINE: 'badge-gray',
    INSTALLING: 'badge-blue',
    INSTALL_FAILED: 'badge-red',
    REINSTALLING: 'badge-blue',
    SUSPENDED: 'badge-red',
    RESTORING_BACKUP: 'badge bg-purple-500/20 text-purple-400',
    UNKNOWN: 'badge-gray',
  };
  return badges[status] || 'badge-gray';
}

export function getServerStatusDot(status: ServerStatus): string {
  const dots: Record<ServerStatus, string> = {
    RUNNING: 'bg-green-400',
    STARTING: 'bg-yellow-400 animate-pulse',
    STOPPING: 'bg-orange-400 animate-pulse',
    OFFLINE: 'bg-slate-500',
    INSTALLING: 'bg-blue-400 animate-pulse',
    INSTALL_FAILED: 'bg-red-400',
    REINSTALLING: 'bg-blue-400 animate-pulse',
    SUSPENDED: 'bg-red-400',
    RESTORING_BACKUP: 'bg-purple-400 animate-pulse',
    UNKNOWN: 'bg-slate-600',
  };
  return dots[status] || 'bg-slate-500';
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return formatDate(dateString);
}
