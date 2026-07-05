import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, requireAdmin, optionalAuth } from '../middleware/auth';
import { AuthRequest } from '../types';
import { checkForUpdate } from '../services/updateCheck';

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
};

const PROVIDER_KEY_SETTING: Record<string, string> = {
  openai: 'ai.openaiKey',
  gemini: 'ai.geminiKey',
  anthropic: 'ai.anthropicKey',
};

// Keys safe to expose without authentication (sidebar/login branding, public
// feature flags). Everything else (SMTP creds, AI provider keys) is stripped
// out below unless the request comes from a logged-in admin.
const PUBLIC_KEYS = new Set(['app.name', 'app.title', 'app.logo', 'app.description', 'app.version', 'features.aiTools', 'ai.provider', 'ai.configured', 'curseforge.configured', 'theme.customCss', 'whitelabel.hidePoweredBy']);

router.get('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await prisma.setting.findMany();
    const settings: Record<string, string> = { ...DEFAULTS };
    for (const r of rows) settings[r.key] = r.value;
    const providerKey = PROVIDER_KEY_SETTING[settings['ai.provider']] || 'ai.openaiKey';
    settings['ai.configured'] = settings[providerKey] ? 'true' : 'false';
    settings['curseforge.configured'] = settings['curseforge.apiKey'] ? 'true' : 'false';
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
  const allowed = [
    'app.name', 'app.title', 'app.logo', 'app.description',
    'smtp.host', 'smtp.port', 'smtp.user', 'smtp.pass', 'smtp.from',
    'features.aiTools', 'ai.provider', 'ai.openaiKey', 'ai.geminiKey', 'ai.anthropicKey',
    'curseforge.apiKey',
    'theme.customCss', 'whitelabel.hidePoweredBy',
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
  return res.json({ message: 'Settings saved' });
});

export default router;
