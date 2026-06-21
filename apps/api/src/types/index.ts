import { Request } from 'express';
import { User } from '@prisma/client';

export interface AuthRequest extends Request {
  user?: User;
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface ServerStats {
  cpuAbsolute: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  diskBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  uptime: number;
  state: string;
}

export interface PaginationQuery {
  page?: string;
  perPage?: string;
  search?: string;
  sort?: string;
  sortDir?: 'asc' | 'desc';
}

export interface ApiResponse<T = unknown> {
  data?: T;
  meta?: {
    total: number;
    page: number;
    perPage: number;
    lastPage: number;
  };
  message?: string;
  errors?: Record<string, string[]>;
}
