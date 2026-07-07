import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { getApiBaseUrl, getFrontendOrigin } from './auth';
import { logger } from '../utils/logger';

// The self-hosted install's half of "Connect with Stripe" — see
// stripeConnectRelay.ts for the central relay half and the full flow
// diagram in this feature's plan. This file never touches the platform
// secret; it only ever talks to Stripe's public authorize endpoint and to
// the relay's own exchange/deauthorize endpoints.
const router = Router();

const JWT_SECRET = process.env.JWT_SECRET!;

// Public identifier for the Kretase Stripe Connect platform app — safe to
// ship in every self-hosted install (it's visible in every authorize URL
// sent to Stripe anyway), unlike the platform secret key. Every install
// funnels through the same platform, so this is one shared value rather
// than something each admin configures.
// TODO: replace with the real Connect application's client_id once the
// Kretase project has registered a platform on Stripe's dashboard.
const STRIPE_CONNECT_CLIENT_ID = process.env.STRIPE_CONNECT_CLIENT_ID || '';

// The one fixed, project-owned relay every install's OAuth kickoff points
// at — see stripeConnectRelay.ts. Overridable via env for local/staging
// testing against a non-production relay.
const STRIPE_CONNECT_RELAY_BASE_URL = process.env.STRIPE_CONNECT_RELAY_BASE_URL || 'https://panel.kretase.com';

const STRIPE_SETTING_KEYS = [
  'stripe.connect.accountId',
  'stripe.connect.accessToken',
  'stripe.connect.refreshToken',
  'stripe.connect.publishableKey',
] as const;

export interface ConnectState {
  nonce: string;
  returnUrl: string;
}

// Extracted for unit testing, and so /start and /complete can't drift out
// of sync with each other on the token shape/expiry.
export function signConnectState(returnUrl: string): string {
  return jwt.sign({ nonce: crypto.randomBytes(8).toString('hex'), returnUrl }, JWT_SECRET, { expiresIn: '10m' });
}

// Full verification (signature + expiry) — only ever called back at the
// originating install in /complete, since the central relay doesn't hold
// JWT_SECRET and can only jwt.decode() (see stripeConnectRelay.ts).
export function verifyConnectState(state: string): ConnectState {
  return jwt.verify(state, JWT_SECRET) as ConnectState;
}

// Returns the authorize URL as JSON rather than issuing a redirect itself.
// This route needs `authenticate` (only an admin should be able to kick off
// a connection), but the admin panel's JWT lives in localStorage and is
// attached by axios's own interceptor — it's never sent by the browser on a
// plain top-level navigation (no cookie session here, unlike Discord's
// login-kickoff redirect, which is deliberately unauthenticated since it
// creates a session rather than requiring one). So the frontend calls this
// as a normal authenticated fetch first, then navigates itself once it has
// the URL, instead of pointing an <a href> straight at this route.
router.get('/start', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  if (!STRIPE_CONNECT_CLIENT_ID) {
    return res.status(503).json({ message: 'Stripe Connect is not configured on this deployment yet' });
  }

  const returnUrl = `${getApiBaseUrl()}/api/v1/stripe-connect/finish`;
  const state = signConnectState(returnUrl);

  const params = new URLSearchParams({
    client_id: STRIPE_CONNECT_CLIENT_ID,
    redirect_uri: `${STRIPE_CONNECT_RELAY_BASE_URL}/stripe-connect/oauth/callback`,
    response_type: 'code',
    scope: 'read_write',
    state,
  });
  return res.json({ url: `https://connect.stripe.com/oauth/authorize?${params.toString()}` });
});

// Reached via a browser redirect from the central relay (not an API call —
// there's no way to attach an Authorization header to a full-page browser
// navigation). Deliberately does no verification itself and hands nothing
// sensitive to the browser beyond a short-lived, single-use exchange code;
// it just bounces to a frontend page that already holds the admin's JWT and
// can make an authenticated POST to /complete.
router.get('/finish', async (req: Request, res: Response) => {
  const frontend = getFrontendOrigin();
  const { exchange_code, state, error } = req.query as Record<string, string | undefined>;

  if (error) return res.redirect(`${frontend}/admin/integrations?stripeError=${encodeURIComponent(error)}`);
  if (!exchange_code || !state) return res.redirect(`${frontend}/admin/integrations?stripeError=invalid`);

  return res.redirect(
    `${frontend}/admin/integrations?stripeExchangeCode=${encodeURIComponent(exchange_code)}&stripeState=${encodeURIComponent(state)}`
  );
});

router.post('/complete', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { exchangeCode, state } = req.body as { exchangeCode?: string; state?: string };
  if (!exchangeCode || !state) return res.status(422).json({ message: 'exchangeCode and state are required' });

  // This is what actually proves the redemption is tied to a real,
  // admin-initiated /start call and hasn't expired or been replayed — the
  // relay couldn't check this itself since it doesn't hold JWT_SECRET.
  try {
    verifyConnectState(state);
  } catch {
    return res.status(400).json({ message: 'Invalid or expired Stripe connection attempt — please try connecting again' });
  }

  try {
    const exchangeResp = await axios.post(`${STRIPE_CONNECT_RELAY_BASE_URL}/stripe-connect/oauth/exchange`, { exchangeCode });
    const { stripeUserId, accessToken, refreshToken, publishableKey } = exchangeResp.data as {
      stripeUserId: string; accessToken: string; refreshToken: string; publishableKey: string;
    };

    await Promise.all([
      prisma.setting.upsert({ where: { key: 'stripe.connect.accountId' }, update: { value: stripeUserId }, create: { key: 'stripe.connect.accountId', value: stripeUserId } }),
      prisma.setting.upsert({ where: { key: 'stripe.connect.accessToken' }, update: { value: accessToken }, create: { key: 'stripe.connect.accessToken', value: accessToken } }),
      prisma.setting.upsert({ where: { key: 'stripe.connect.refreshToken' }, update: { value: refreshToken }, create: { key: 'stripe.connect.refreshToken', value: refreshToken } }),
      prisma.setting.upsert({ where: { key: 'stripe.connect.publishableKey' }, update: { value: publishableKey }, create: { key: 'stripe.connect.publishableKey', value: publishableKey } }),
    ]);

    return res.json({ connected: true, accountId: stripeUserId });
  } catch (err) {
    logger.warn(`Stripe Connect completion failed: ${(err as Error).message}`);
    return res.status(502).json({ message: 'Failed to complete the Stripe connection — the exchange code may have expired. Please try again.' });
  }
});

router.post('/disconnect', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  const [accountRow, accessTokenRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'stripe.connect.accountId' } }),
    prisma.setting.findUnique({ where: { key: 'stripe.connect.accessToken' } }),
  ]);

  if (accountRow?.value && accessTokenRow?.value) {
    // Best-effort — the local Setting rows get deleted regardless, since an
    // admin clicking "Disconnect" should always end up disconnected locally
    // even if the relay/Stripe call fails (network blip, relay down, etc.).
    // accessToken proves to the relay that this install actually owns the
    // connection being deauthorized — see the comment on the relay's
    // /oauth/deauthorize handler for why a bare account id isn't enough.
    await axios
      .post(`${STRIPE_CONNECT_RELAY_BASE_URL}/stripe-connect/oauth/deauthorize`, { stripeUserId: accountRow.value, accessToken: accessTokenRow.value })
      .catch((err) => logger.warn(`Stripe Connect deauthorize call failed: ${(err as Error).message}`));
  }

  await prisma.setting.deleteMany({ where: { key: { in: [...STRIPE_SETTING_KEYS] } } });
  return res.json({ disconnected: true });
});

export default router;
