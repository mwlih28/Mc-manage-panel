# Security Policy

## Supported Versions

Only the latest tagged release is supported. Security fixes are not
backported to older tags — run `update-panel.sh` / `update-wings.sh`
(or `git pull` + rebuild) to stay current.

## Reporting a Vulnerability

If you find a security issue in Kretase, please report it privately
instead of opening a public GitHub issue:

- Open a [GitHub Security Advisory](../../security/advisories/new) for
  this repository (preferred — keeps the report private until a fix
  ships), or
- Email the maintainer with details and reproduction steps.

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce (a minimal repro is ideal)
- Affected version/commit

We'll acknowledge reports within a few days and keep you updated as a
fix is developed. Please give us a reasonable amount of time to release
a patch before any public disclosure.

## Scope

In scope: the panel API (`apps/api`), web UI (`apps/web`), Wings daemon
(`apps/wings`), and the install/update scripts in `scripts/`.

Out of scope: vulnerabilities in third-party dependencies should be
reported upstream (we track dependency updates via Dependabot and will
pick up upstream fixes on the next release).
