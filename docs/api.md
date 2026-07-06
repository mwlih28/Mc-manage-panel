# API Guide

Kretase's API is versioned under `/api/v1`. There are two ways to authenticate against it, depending on whether you're the panel's own frontend or a third-party integration (billing system, automation script, Zapier/n8n-style tool).

## Authenticating

### Session auth (JWT)

Used by the web UI itself. `POST /api/v1/auth/login` returns an access token + refresh token pair; send the access token as `Authorization: Bearer <token>` on subsequent requests. Access tokens are short-lived; use `POST /api/v1/auth/refresh` with the refresh token to get a new pair.

### API keys (for integrations)

Created from **Admin → API Keys**, scoped to exactly the permissions the integration needs. A key looks like `kre_<identifier>.<secret>` and is sent the same way as a JWT:

```bash
curl "https://your-panel.com/api/v1/servers" \
  -H "Authorization: Bearer kre_abc123.xxxxxxxxxxxxxxxx"
```

The secret half is only ever shown once, at creation time — the panel stores a bcrypt hash, not the key itself. If you lose it, revoke the key and create a new one.

## Scopes

API keys are scoped, not all-or-nothing. Available scopes:

| Scope | Grants |
|-------|--------|
| `servers:read` | List/view servers, backups, live resource usage |
| `servers:write` | Create/update/delete servers, manage backups |
| `servers:power` | Start/stop/restart/kill a server and send console commands, without full `servers:write` access — for automation/billing integrations that only need to act on power state |
| `users:read` / `users:write` | View / manage panel users |
| `nodes:read` / `nodes:write` | View / manage nodes |
| `eggs:read` / `eggs:write` | View / manage eggs |

A key can hold multiple scopes, or `*` for full access (admin-equivalent — grant sparingly).

## Full endpoint reference

The exhaustive, always-current list of every integration-facing route — grouped by resource, with the exact scope each one requires and a copy-paste `curl` example — is generated directly from the same source of truth the server uses to *enforce* those scopes, so it can't drift out of date. Find it in the panel itself:

**Admin → API Reference**

## Common operations

```bash
# List servers
curl "$PANEL_URL/api/v1/servers" -H "Authorization: Bearer $API_KEY"

# Start a server
curl -X POST "$PANEL_URL/api/v1/servers/$SERVER_ID/power" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"start"}'

# Create a backup
curl -X POST "$PANEL_URL/api/v1/servers/$SERVER_ID/backups" \
  -H "Authorization: Bearer $API_KEY"
```

## Webhooks (outbound)

For push-based integrations instead of polling, **Admin → Webhooks** lets you register a URL (or a Discord Incoming Webhook) that fires on server/user events — creation, deletion, power actions, backups, and more — with per-webhook event filtering. Generic webhooks are HMAC-signed (`X-Kretase-Signature` header) so you can verify the payload actually came from your panel; there's a "Send Test" button on each webhook to confirm delivery before relying on it.
