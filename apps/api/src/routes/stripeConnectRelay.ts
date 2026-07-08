import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import Stripe from 'stripe';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

// Stripe Connect requires a redirect_uri pre-registered against the
// platform's client_id — self-hosted Kretase installs each live on an
// arbitrary admin-chosen domain, so there's no way to pre-register every
// one of them with Stripe. This relay is the one fixed, project-owned URL
// every install's OAuth kickoff points at; it exchanges the code using the
// platform secret (which must never ship to self-hosted installs) and hands
// the result back to whichever install actually started the flow.
//
// Inert everywhere except the Kretase project's own canonical deployment —
// every self-hosted install ships this same file (open source), but these
// routes 404 unless STRIPE_CONNECT_PLATFORM_SECRET_KEY is set in that one
// deployment's own .env. See apps/api/.env.example for why this is the one
// deliberate exception to "no third-party credential ever lives in .env".
const router = Router();

const EXCHANGE_TTL_MS = 5 * 60 * 1000;

function getPlatformStripe(): Stripe | null {
  const key = process.env.STRIPE_CONNECT_PLATFORM_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}

// The exchange_code query param this redirects with is redeemable for a
// live Stripe access token (see /oauth/exchange below) — and returnUrl's
// host is never verified against anything (see isSafeReturnUrl's comment).
// Rather than silently 302'ing that code to whatever host an attacker
// picked, this renders the real destination and requires an explicit click,
// so a phished admin has a real chance to notice the domain is wrong before
// the exchange code ever reaches it.
function renderContinuePage(destination: string): string {
  let host = destination;
  try { host = new URL(destination).host; } catch { /* keep raw string as fallback */ }
  return `<!doctype html><html><head><meta charset="utf-8"><title>Connecting Stripe account…</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:system-ui,sans-serif;background:#0B0C0E;color:#EDEDEF;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;}
  .card{max-width:440px;background:#131417;border:1px solid #1C1E22;border-radius:12px;padding:32px;text-align:center;}
  .host{font-weight:600;color:#6B9BFF;word-break:break-all;}
  a.btn{display:inline-block;margin-top:20px;padding:10px 20px;background:#2E6FEE;color:#fff;border-radius:8px;text-decoration:none;font-weight:500;}
  p{line-height:1.5;color:#9A9CA3;}
</style></head><body>
<div class="card">
  <h2>Finish connecting your Stripe account</h2>
  <p>Your Stripe account was authorized. To finish, you'll be redirected back to:</p>
  <p class="host">${escapeHtml(host)}</p>
  <p>Only continue if this is your own Kretase panel's domain.</p>
  <a class="btn" href="${escapeHtml(destination)}">Continue</a>
</div>
</body></html>`;
}

// Not a full domain allowlist (infeasible — installs live on unknown
// domains), just enough to stop this relay being used as a generic
// open-redirect gadget for arbitrary protocols/paths. This does NOT stop a
// phishing flow where an attacker gets a victim admin to authorize using a
// `state` whose returnUrl the attacker chose (the relay has no registry of
// legitimate install domains to check the host against) — that's why the
// success path below never silently redirects a real Stripe access token;
// see renderContinuePage.
export function isSafeReturnUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.pathname.endsWith('/api/v1/stripe-connect/finish');
  } catch {
    return false;
  }
}

// The relay doesn't hold the originating install's JWT_SECRET, so it can
// only decode (read the payload of) this token, not verify its signature.
// That's fine — verification happens back at the originating install in
// stripeConnect.ts's /complete handler, which minted it and can check it.
// The relay's only job is learning where to bounce the browser back to, and
// isSafeReturnUrl above is what stops that trust gap being exploitable.
export function extractReturnUrl(state: string): string | null {
  const decoded = jwt.decode(state) as { returnUrl?: string } | null;
  return decoded?.returnUrl && isSafeReturnUrl(decoded.returnUrl) ? decoded.returnUrl : null;
}

router.get('/oauth/callback', async (req: Request, res: Response) => {
  const stripe = getPlatformStripe();
  if (!stripe) return res.status(404).json({ message: 'Stripe Connect relay is not configured on this deployment' });

  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (error || !code || !state) return res.status(400).send('Stripe authorization was cancelled or invalid.');

  const returnUrl = extractReturnUrl(state);
  if (!returnUrl) return res.status(400).send('Invalid or unrecognized return URL.');

  try {
    const tokenResp = await stripe.oauth.token({ grant_type: 'authorization_code', code });
    const exchangeCode = crypto.randomBytes(32).toString('hex');
    await prisma.stripeConnectExchange.create({
      data: {
        code: exchangeCode,
        stripeUserId: tokenResp.stripe_user_id!,
        accessToken: tokenResp.access_token!,
        refreshToken: tokenResp.refresh_token!,
        publishableKey: tokenResp.stripe_publishable_key || '',
        expiresAt: new Date(Date.now() + EXCHANGE_TTL_MS),
      },
    });

    const redirectUrl = new URL(returnUrl);
    redirectUrl.searchParams.set('exchange_code', exchangeCode);
    redirectUrl.searchParams.set('state', state);
    return res.type('html').send(renderContinuePage(redirectUrl.toString()));
  } catch (err) {
    logger.warn(`Stripe Connect relay: token exchange failed: ${(err as Error).message}`);
    const redirectUrl = new URL(returnUrl);
    redirectUrl.searchParams.set('error', 'stripe_exchange_failed');
    return res.redirect(redirectUrl.toString());
  }
});

// Server-to-server only — called by the originating install's own backend,
// never by a browser. Single-use: the row is deleted on first successful
// read, so a leaked exchange_code (e.g. from a shared server log) is only
// useful for the few minutes before the legitimate install redeems it.
router.post('/oauth/exchange', async (req: Request, res: Response) => {
  if (!getPlatformStripe()) return res.status(404).json({ message: 'Stripe Connect relay is not configured on this deployment' });

  const { exchangeCode } = req.body as { exchangeCode?: string };
  if (!exchangeCode) return res.status(422).json({ message: 'exchangeCode is required' });

  const row = await prisma.stripeConnectExchange.findUnique({ where: { code: exchangeCode } });
  if (!row || row.expiresAt < new Date()) {
    if (row) await prisma.stripeConnectExchange.delete({ where: { id: row.id } }).catch(() => {});
    return res.status(404).json({ message: 'Exchange code not found or expired' });
  }

  await prisma.stripeConnectExchange.delete({ where: { id: row.id } });
  return res.json({
    stripeUserId: row.stripeUserId,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    publishableKey: row.publishableKey,
  });
});

// Also server-to-server only. Deauthorize, like the token exchange above,
// must be authenticated with the platform's own secret key — a self-hosted
// install can't call https://connect.stripe.com/oauth/deauthorize directly,
// only the relay can. Unlike /oauth/exchange (protected by an unguessable
// single-use code), a bare stripeUserId isn't a secret — Stripe account ids
// can turn up in receipts, webhook payloads, or a careless log line, so
// accepting one alone here would let anyone who's seen an account id
// disconnect it. Require the caller to also present that account's own
// access token and verify it actually resolves to the claimed id first —
// only whoever legitimately holds the connection (the one install that
// completed it) has that token.
router.post('/oauth/deauthorize', async (req: Request, res: Response) => {
  const stripe = getPlatformStripe();
  if (!stripe) return res.status(404).json({ message: 'Stripe Connect relay is not configured on this deployment' });

  const { stripeUserId, accessToken } = req.body as { stripeUserId?: string; accessToken?: string };
  if (!stripeUserId || !accessToken) return res.status(422).json({ message: 'stripeUserId and accessToken are required' });

  try {
    const claimedAccount = new Stripe(accessToken);
    const account = await claimedAccount.accounts.retrieveCurrent();
    if (account.id !== stripeUserId) {
      return res.status(403).json({ message: 'accessToken does not match stripeUserId' });
    }
  } catch (err) {
    logger.warn(`Stripe Connect relay: deauthorize ownership check failed for ${stripeUserId}: ${(err as Error).message}`);
    return res.status(403).json({ message: 'Could not verify ownership of this Stripe connection' });
  }

  try {
    await stripe.oauth.deauthorize({ client_id: process.env.STRIPE_CONNECT_CLIENT_ID, stripe_user_id: stripeUserId });
    return res.json({ deauthorized: true });
  } catch (err) {
    // Best-effort from the caller's perspective (stripeConnect.ts deletes its
    // local Setting rows regardless) — still surface the real failure so it
    // isn't silently swallowed twice.
    logger.warn(`Stripe Connect relay: deauthorize failed for ${stripeUserId}: ${(err as Error).message}`);
    return res.status(502).json({ message: 'Deauthorize failed' });
  }
});

export default router;
