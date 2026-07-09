export type Role = 'USER' | 'ADMIN';
export type NodeStatus = 'ONLINE' | 'OFFLINE' | 'MAINTENANCE';
export type ServerStatus =
  | 'INSTALLING'
  | 'INSTALL_FAILED'
  | 'REINSTALLING'
  | 'SUSPENDED'
  | 'RESTORING_BACKUP'
  | 'MIGRATING'
  | 'MIGRATION_FAILED'
  | 'CLONING'
  | 'CLONE_FAILED'
  | 'OFFLINE'
  | 'STARTING'
  | 'STOPPING'
  | 'RUNNING'
  | 'UNKNOWN';

export interface User {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: Role;
  rootAdmin: boolean;
  language: string;
  twoFactor: boolean;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
  lastLogin?: string;
  _count?: { servers: number };
}

export interface Node {
  id: string;
  name: string;
  description?: string;
  fqdn: string;
  scheme: string;
  port: number;
  daemonPort: number;
  daemonSftp: number;
  memory: number;
  memoryOverallocate: number;
  disk: number;
  diskOverallocate: number;
  cpu: number;
  uploadSize: number;
  behindProxy: boolean;
  maintenanceMode: boolean;
  token: string;
  status: NodeStatus;
  setupToken?: string | null;
  setupTokenExpiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { servers: number; allocations: number };
}

export interface Allocation {
  id: string;
  nodeId: string;
  ip: string;
  ipAlias?: string;
  port: number;
  notes?: string;
  assigned: boolean;
  serverId?: string;
  server?: { id: string; name: string; uuid: string };
}

export interface Egg {
  id: string;
  nestId: string;
  uuid: string;
  author: string;
  name: string;
  description?: string;
  dockerImage: string;
  startup: string;
  configStop: string;
  scriptInstall?: string | null;
  logoUrl?: string | null;
  variables?: EggVariable[];
  nest?: Nest;
  _count?: { servers: number };
}

export interface EggVariable {
  id: string;
  eggId: string;
  name: string;
  description?: string;
  envVariable: string;
  defaultValue: string;
  userViewable: boolean;
  userEditable: boolean;
  rules: string;
}

export interface Nest {
  id: string;
  uuid: string;
  author: string;
  name: string;
  description?: string;
  eggs?: Egg[];
  _count?: { eggs: number };
}

export interface Server {
  id: string;
  uuid: string;
  uuidShort: string;
  userId: string;
  nodeId: string;
  eggId: string;
  allocationId?: string;
  name: string;
  description?: string;
  status: ServerStatus;
  suspended: boolean;
  memory: number;
  swap: number;
  disk: number;
  io: number;
  cpu: number;
  startup: string;
  image: string;
  env: string;
  eulaAccepted: boolean;
  databaseLimit: number;
  allocationLimit: number;
  backupLimit: number;
  crashDetectionEnabled: boolean;
  autoOptimizeEnabled: boolean;
  publicStatusEnabled: boolean;
  publicSlug?: string | null;
  publicStatusAccentColor?: string | null;
  publicStatusBanner?: string | null;
  publicStatusLogo?: string | null;
  publicStatusAnnouncement?: string | null;
  publicStatusCustomCss?: string | null;
  createdAt: string;
  updatedAt: string;
  user?: Pick<User, 'id' | 'email' | 'username'>;
  node?: Pick<Node, 'id' | 'name' | 'fqdn' | 'scheme' | 'daemonPort' | 'daemonSftp'>;
  egg?: Pick<Egg, 'id' | 'name'> & { variables?: EggVariable[]; nest?: Nest };
  allocation?: Allocation;
  _count?: { backups: number; databases: number };
  // Downsampled last-24h CPU history, attached by GET /stats/overview so the
  // dashboard can draw a per-row sparkline. Absent on other endpoints.
  cpuTrend?: number[];
}

export interface Backup {
  id: string;
  serverId: string;
  uuid: string;
  name: string;
  isSuccessful: boolean;
  isLocked: boolean;
  ignoredFiles: string;
  disk: string;
  checksum?: string;
  bytes: number;
  completedAt?: string;
  createdAt: string;
}

export interface ServerStats {
  serverId: string;
  cpuAbsolute: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  diskBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  uptime: number;
  timestamp: number;
}

export interface ActivityLog {
  id: string;
  userId?: string;
  serverId?: string;
  event: string;
  properties: string;
  ip?: string;
  timestamp: string;
  user?: Pick<User, 'id' | 'username' | 'email'>;
}

export interface ApiMeta {
  total: number;
  page: number;
  perPage: number;
  lastPage: number;
}

export interface ApiResponse<T> {
  data: T;
  meta?: ApiMeta;
  message?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
