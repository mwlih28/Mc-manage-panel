# Kretase billing/store integrations

## WHMCS (`whmcs/kretase/kretase.php`)

A standard WHMCS provisioning module. Copy `kretase.php` into
`modules/servers/kretase/` in your WHMCS install, add a Server with your
panel URL as the hostname and a Kretase admin API key (`users:write` +
`servers:write` scopes, created under Admin → API Keys) as the password,
then assign it to a product. Calls Kretase's existing admin REST API — the
same one documented under Admin → API Reference in the panel — for account
creation, suspension, unsuspension, and termination.

## Blesta (`blesta/kretase/kretase_module.php`)

Implements the same lifecycle against Blesta's module interface. Blesta
expects a few more scaffolding files (a `kretase_module.json` config file,
a language file, a logo) that aren't included here — this file is the part
that actually talks to Kretase and is the one worth reviewing; the rest is
metadata Blesta needs to display the module in its admin UI.

## Tebex / CraftingStore

These are configured entirely from the Kretase admin panel (Admin →
Store Integrations) rather than as a file you install elsewhere — create an
integration, map package IDs to console commands (e.g. granting an in-game
rank), and paste the generated webhook URL + secret into your Tebex or
CraftingStore dashboard's webhook settings.

## A note on verification

These were written against each platform's documented API/module
conventions but have not been tested against a live WHMCS, Blesta, Tebex,
or CraftingStore account — that requires accounts on those platforms.
Test in a staging environment before relying on this for real orders.
