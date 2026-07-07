import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin, optionalAuth } from '../middleware/auth';
import { AuthRequest } from '../types';
import { checkForUpdate } from '../services/updateCheck';
import { isConfigured as isStorageConfigured } from '../services/storage';
import { restartDiscordBot } from '../services/discordBot';

const router = Router();

// GET /settings/update-check — admin only. Compares the running panel
// version against the latest published GitHub release.
router.get('/update-check', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  const result = await checkForUpdate();
  return res.json(result);
});

const DEFAULTS: Record<string, string> = {
  'app.name': 'Kretase',
  'app.title': 'Kretase',
  'app.logo': '',
  'app.description': 'High-performance game server management',
  'features.aiTools': 'true',
  'ai.provider': 'openai',
  'theme.customCss': '',
  'whitelabel.hidePoweredBy': 'false',
  'storage.provider': 'none',
  'storage.deleteLocalAfterUpload': 'false',
  'discord.botToken': '',
  'discord.oauth.enabled': 'false',
  'discord.oauth.clientId': '',
  'discord.oauth.clientSecret': '',
  'captcha.provider': 'none',
  'captcha.siteKey': '',
  'stripe.connect.accountId': '',
  'stripe.connect.accessToken': '',
  'stripe.connect.refreshToken': '',
  'stripe.connect.publishableKey': '',
  'paytr.merchantId': '',
  'paytr.merchantKey': '',
  'paytr.merchantSalt': '',
  'paytr.testMode': 'false',
};

const PROVIDER_KEY_SETTING: Record<string, string> = {
  openai: 'ai.openaiKey',
  gemini: 'ai.geminiKey',
  anthropic: 'ai.anthropicKey',
};

const STORAGE_PROVIDERS = new Set(['none', 's3', 'sftp', 'gdrive']);
const CAPTCHA_PROVIDERS = new Set(['none', 'hcaptcha']);

// Keys safe to expose without authentication (sidebar/login branding, public
// feature flags). Everything else (SMTP creds, AI provider keys) is stripped
// out below unless the request comes from a logged-in admin. captcha.siteKey
// is intentionally public — hCaptcha's own site key is meant to ship to the
// browser, that's how the widget knows which site it's protecting. Only
// captcha.secretKey (used server-side to verify a solve) stays admin-only.
const PUBLIC_KEYS = new Set(['app.name', 'app.title', 'app.logo', 'app.description', 'app.version', 'features.aiTools', 'ai.provider', 'ai.configured', 'curseforge.configured', 'theme.customCss', 'whitelabel.hidePoweredBy', 'discord.configured', 'discord.oauth.enabled', 'captcha.provider', 'captcha.siteKey', 'captcha.configured', 'stripe.configured', 'paytr.configured']);

router.get('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await prisma.setting.findMany();
    const settings: Record<string, string> = { ...DEFAULTS };
    for (const r of rows) settings[r.key] = r.value;
    const providerKey = PROVIDER_KEY_SETTING[settings['ai.provider']] || 'ai.openaiKey';
    settings['ai.configured'] = settings[providerKey] ? 'true' : 'false';
    settings['curseforge.configured'] = settings['curseforge.apiKey'] ? 'true' : 'false';
    settings['storage.configured'] = isStorageConfigured(settings) ? 'true' : 'false';
    settings['discord.configured'] = settings['discord.botToken'] ? 'true' : 'false';
    settings['captcha.configured'] = (settings['captcha.provider'] === 'hcaptcha' && settings['captcha.siteKey'] && settings['captcha.secretKey']) ? 'true' : 'false';
    settings['stripe.configured'] = settings['stripe.connect.accountId'] ? 'true' : 'false';
    settings['paytr.configured'] = (settings['paytr.merchantId'] && settings['paytr.merchantKey'] && settings['paytr.merchantSalt']) ? 'true' : 'false';
    // Sourced from the deployed .env, not the DB — install/update-panel.sh
    // keep PANEL_VERSION in sync with the actual release tag on every run.
    settings['app.version'] = process.env.PANEL_VERSION || '1.0.0';

    if (req.user?.role !== 'ADMIN') {
      for (const key of Object.keys(settings)) {
        if (!PUBLIC_KEYS.has(key)) delete settings[key];
      }
    }
    return res.json(settings);
  } catch {
    return res.json(DEFAULTS);
  }
});

router.put('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  if (req.body['ai.provider'] !== undefined && !PROVIDER_KEY_SETTING[req.body['ai.provider']]) {
    return res.status(422).json({ message: 'Invalid ai.provider — must be openai, gemini, or anthropic' });
  }
  if (req.body['storage.provider'] !== undefined && !STORAGE_PROVIDERS.has(req.body['storage.provider'])) {
    return res.status(422).json({ message: 'Invalid storage.provider — must be none, s3, sftp, or gdrive' });
  }
  if (req.body['captcha.provider'] !== undefined && !CAPTCHA_PROVIDERS.has(req.body['captcha.provider'])) {
    return res.status(422).json({ message: 'Invalid captcha.provider — must be none or hcaptcha' });
  }
  const allowed = [
    'app.name', 'app.title', 'app.logo', 'app.description',
    'smtp.host', 'smtp.port', 'smtp.user', 'smtp.pass', 'smtp.from',
    'features.aiTools', 'ai.provider', 'ai.openaiKey', 'ai.geminiKey', 'ai.anthropicKey',
    'curseforge.apiKey',
    'theme.customCss', 'whitelabel.hidePoweredBy',
    'storage.provider', 'storage.deleteLocalAfterUpload',
    'storage.s3.endpoint', 'storage.s3.region', 'storage.s3.bucket', 'storage.s3.accessKeyId',
    'storage.s3.secretAccessKey', 'storage.s3.forcePathStyle', 'storage.s3.prefix',
    'storage.sftp.host', 'storage.sftp.port', 'storage.sftp.username', 'storage.sftp.password',
    'storage.sftp.privateKey', 'storage.sftp.basePath',
    'storage.gdrive.serviceAccountJson', 'storage.gdrive.folderId',
    'discord.botToken',
    'discord.oauth.enabled', 'discord.oauth.clientId', 'discord.oauth.clientSecret',
    'captcha.provider', 'captcha.siteKey', 'captcha.secretKey',
    // Unlike stripe.connect.* (OAuth-derived, written only by
    // stripeConnect.ts's /complete handler), these are plain admin-typed
    // credentials from the merchant's own PayTR panel — same category as
    // smtp.pass/discord.botToken, so they belong in this form.
    'paytr.merchantId', 'paytr.merchantKey', 'paytr.merchantSalt', 'paytr.testMode',
  ];
  if (req.body['theme.customCss'] !== undefined) {
    const css = req.body['theme.customCss'];
    if (typeof css !== 'string' || css.length > 20000) {
      return res.status(422).json({ message: 'Custom CSS must be 20,000 characters or fewer' });
    }
  }
  const updates: Array<{ key: string; value: string }> = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      // Strip anything that could break out of the <style> tag it's rendered
      // in — still arbitrary CSS after this, just not a script/HTML injection vector.
      const value = key === 'theme.customCss'
        ? String(req.body[key]).replace(/<\/style/gi, '')
        : String(req.body[key]);
      updates.push({ key, value });
    }
  }
  for (const u of updates) {
    await prisma.setting.upsert({
      where: { key: u.key },
      update: { value: u.value },
      create: { key: u.key, value: u.value },
    });
  }
  // Failures are already logged inside startDiscordBot (e.g. bad token) —
  // fire-and-forget so saving settings never waits on a Discord login.
  if (req.body['discord.botToken'] !== undefined) restartDiscordBot().catch(() => {});
  return res.json({ message: 'Settings saved' });
});

export default router;
