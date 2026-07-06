import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ServerStatus } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number | undefined | null, decimals = 2): string {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
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
    RUNNING: 'text-[#3EC896]',
    STARTING: 'text-[#F0B93D]',
    STOPPING: 'text-[#F0B93D]',
    OFFLINE: 'text-zinc-500',
    INSTALLING: 'text-[#A78BFA]',
    INSTALL_FAILED: 'text-[#F27074]',
    REINSTALLING: 'text-[#A78BFA]',
    SUSPENDED: 'text-[#F27074]',
    RESTORING_BACKUP: 'text-[#A78BFA]',
    MIGRATING: 'text-[#4DD9E8]',
    MIGRATION_FAILED: 'text-[#F27074]',
    CLONING: 'text-[#4DD9E8]',
    CLONE_FAILED: 'text-[#F27074]',
    UNKNOWN: 'text-zinc-600',
  };
  return colors[status] || 'text-zinc-500';
}

export function getServerStatusBadge(status: ServerStatus): string {
  const badges: Record<ServerStatus, string> = {
    RUNNING: 'badge-green',
    STARTING: 'badge-yellow',
    STOPPING: 'badge-yellow',
    OFFLINE: 'badge-gray',
    INSTALLING: 'badge-indigo',
    INSTALL_FAILED: 'badge-red',
    REINSTALLING: 'badge-indigo',
    SUSPENDED: 'badge-red',
    RESTORING_BACKUP: 'badge-indigo',
    MIGRATING: 'badge bg-[#4DD9E8]/15 text-[#4DD9E8]',
    MIGRATION_FAILED: 'badge-red',
    CLONING: 'badge bg-[#4DD9E8]/15 text-[#4DD9E8]',
    CLONE_FAILED: 'badge-red',
    UNKNOWN: 'badge-gray',
  };
  return badges[status] || 'badge-gray';
}

export function getServerStatusDot(status: ServerStatus): string {
  const dots: Record<ServerStatus, string> = {
    RUNNING: 'bg-[#3EC896]',
    STARTING: 'bg-[#F0B93D] animate-pulse',
    STOPPING: 'bg-[#F0B93D] animate-pulse',
    OFFLINE: 'bg-zinc-600',
    INSTALLING: 'bg-[#A78BFA] animate-pulse',
    INSTALL_FAILED: 'bg-[#F27074]',
    REINSTALLING: 'bg-[#A78BFA] animate-pulse',
    SUSPENDED: 'bg-[#F27074]',
    RESTORING_BACKUP: 'bg-[#A78BFA] animate-pulse',
    MIGRATING: 'bg-[#4DD9E8] animate-pulse',
    MIGRATION_FAILED: 'bg-[#F27074]',
    CLONING: 'bg-[#4DD9E8] animate-pulse',
    CLONE_FAILED: 'bg-[#F27074]',
    UNKNOWN: 'bg-zinc-700',
  };
  return dots[status] || 'bg-zinc-600';
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
