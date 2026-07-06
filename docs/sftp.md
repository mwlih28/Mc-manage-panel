# SFTP Access

Every server can be reached over real SFTP, directly from Wings — no separate credentials to manage, and no shared filesystem access between servers or nodes.

## Connection details

Shown on a server's **Files** tab in the panel:

| Field | Value |
|-------|-------|
| Host | The node's FQDN |
| Port | `2022` by default (configurable per node in Admin → Nodes) |
| Username | `<your-panel-username>.<server-short-id>` |
| Password | Your panel account password |

There's no separate SFTP password to set up or remember — it's checked against the same credentials you log into the panel with, at connection time.

## Connecting

Any standard SFTP client works — FileZilla, WinSCP, Cyberduck, or the command line:

```bash
sftp -P 2022 yourname.a1b2c3d4@node1.yourdomain.com
```

## Scope and permissions

A login is authorized for exactly one server — the one baked into the username — and only if you're that server's owner or a panel admin. There is currently no way to grant a subuser SFTP access to a server they don't own; subuser server-access grants aren't enforced on any access path in Kretase yet (console, file manager, or SFTP), not just this one.

Once connected, you're chrooted to that server's own data directory — you cannot browse to another server's files, another user's files, or anything else on the node's disk, regardless of what path you request.

## Troubleshooting

**Connection refused** — confirm the node is online in Admin → Nodes, and that the SFTP port shown for that node is reachable (the Wings installer opens `2022/tcp` in UFW automatically; a cloud provider's separate security-group firewall may still need it opened manually).

**Authentication failed** — double check you're using your panel password, not an old one, and that the username is exactly `<panel-username>.<server-short-id>` (the short ID is the same one shown in the server's URL in the panel). Repeated failed attempts are rate-limited for a short window, both at the panel and at Wings.
