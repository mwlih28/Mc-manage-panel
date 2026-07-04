import { Request } from 'express';
import { User } from '@prisma/client';

export interface AuthRequest extends Request {
  user?: User;
  // Set only when the request was authenticated via an admin API key
  // (Authorization: Bearer kre_<identifier>.<secret>) instead of a normal
  // session JWT. undefined for session-authenticated requests, which
  // already carry full rights for their role and skip scope checks.
  apiKeyScopes?: string[];
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  // Only ever set on the short-lived token minted by POST /auth/login when
  // 2FA is required — must never be accepted as a real access token.
  pending?: boolean;
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
