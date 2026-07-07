# Certificate registry

`registry.json` is the single source of truth for both `/partners.html`
(the showcase grid) and `/verify.html` (the lookup tool) — a plain static
JSON array fetched client-side, no backend involved.

Add one entry per issued certificate:

```json
{
  "id": "KRT-2026-0001",
  "company": "Example Hosting",
  "issued": "2026-07",
  "status": "active",
  "image": "assets/certificates/example-hosting.jpg"
}
```

- `id` — exact Certificate ID as printed on the certificate (`KRT-YYYY-NNNN`).
- `company` — the accredited company's public name.
- `issued` — `YYYY-MM`, matches the "Issue Date" on the certificate.
- `status` — `active` or `revoked`. Revoked certs stay in the registry (for
  lookup/transparency) but are excluded from the partners grid and show a
  revoked notice on the verify page.
- `image` — path to the Canva-exported certificate image, dropped in this
  same folder.

Only non-sensitive, already-public information belongs here — no contact
details, no internal notes.
