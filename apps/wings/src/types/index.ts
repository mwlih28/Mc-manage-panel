export interface WingsConfig {
  debug: boolean;
  uuid: string;
  token: string;
  remote: string;
  api: {
    host: string;
    port: number;
    ssl: {
      enabled: boolean;
      cert?: string;
      key?: string;
    };
  };
  system: {
    data: string;
    sftp_bind_port: number;
    username: string;
    timezone: string;
  };
  docker: {
    socket: string;
    network: string;
    tmpfs_size: number;
    container_pid_limit: number;
  };
  throttles: {
    kill_at_count: number;
    decay: number;
    bytes: number;
    check_interval_ms: number;
    lines: number;
  };
}

export interface ServerConfig {
  uuid: string;
  suspended: boolean;
  environment: Record<string, string>;
  invocation: string;
  image: string;
  installScript?: string;
  scriptContainer?: string;
  build: {
    memory_limit: number;
    swap: number;
    disk_space: number;
    io_weight: number;
    cpu_limit: number;
    threads?: string;
    oom_disabled: boolean;
  };
  mounts: Mount[];
  egg: {
    id: string;
    file_denylist: string[];
  };
  container: {
    id?: string;
    image: string;
    requires_rebuild: boolean;
  };
}

export interface Mount {
  source: string;
  target: string;
  read_only: boolean;
}

export interface ServerProcess {
  uuid: string;
  containerId?: string;
  status: ServerStatus;
  startedAt?: Date;
}

export type ServerStatus =
  | 'offline'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'installing';

export interface ResourceUsage {
  memory_bytes: number;
  memory_limit_bytes: number;
  cpu_absolute: number;
  disk_bytes: number;
  network_rx_bytes: number;
  network_tx_bytes: number;
  uptime: number;
  state: string;
}

export interface ConsoleMessage {
  type: 'console';
  data: string;
}

export interface StatMessage {
  type: 'stats';
  data: ResourceUsage;
}

export interface StatusMessage {
  type: 'status';
  data: { state: string };
}
