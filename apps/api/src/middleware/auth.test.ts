import { describe, it, expect, vi } from 'vitest';
import { requireScope } from './auth';
import { AuthRequest } from '../types';
import { Response } from 'express';

function mockRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('requireScope', () => {
  it('passes through session-authenticated requests (no apiKeyScopes)', () => {
    const req = {} as AuthRequest;
    const res = mockRes();
    const next = vi.fn();
    requireScope('servers:read')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows an API key with the exact required scope', () => {
    const req = { apiKeyScopes: ['servers:read'] } as AuthRequest;
    const res = mockRes();
    const next = vi.fn();
    requireScope('servers:read')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects an API key missing the required scope', () => {
    const req = { apiKeyScopes: ['servers:read'] } as AuthRequest;
    const res = mockRes();
    const next = vi.fn();
    requireScope('servers:write')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'API key is missing required scope: servers:write' });
  });

  it('allows a "*" wildcard-scoped key on any required scope', () => {
    const req = { apiKeyScopes: ['*'] } as AuthRequest;
    const res = mockRes();
    const next = vi.fn();
    requireScope('users:write')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('accepts an array of acceptable scopes, satisfied by any one', () => {
    const req = { apiKeyScopes: ['servers:power'] } as AuthRequest;
    const res = mockRes();
    const next = vi.fn();
    requireScope(['servers:power', 'servers:write'])(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects when none of an array of acceptable scopes are granted', () => {
    const req = { apiKeyScopes: ['servers:read'] } as AuthRequest;
    const res = mockRes();
    const next = vi.fn();
    requireScope(['servers:power', 'servers:write'])(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'API key is missing required scope: servers:power or servers:write' });
  });
});
