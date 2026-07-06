import axios from 'axios';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

// Returns true (allow the request through) whenever captcha isn't configured
// — this is what makes the feature backward-compatible by construction, the
// same pattern as getStorageAdapter() returning null when unconfigured.
export async function verifyCaptcha(token: string | undefined, remoteIp?: string): Promise<boolean> {
  const [providerRow, secretRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'captcha.provider' } }),
    prisma.setting.findUnique({ where: { key: 'captcha.secretKey' } }),
  ]);

  if (providerRow?.value !== 'hcaptcha') return true;
  if (!secretRow?.value || !token) return false;

  try {
    const params = new URLSearchParams({ secret: secretRow.value, response: token });
    if (remoteIp) params.set('remoteip', remoteIp);

    const { data } = await axios.post('https://hcaptcha.com/siteverify', params, { timeout: 8000 });
    return data.success === true;
  } catch (err) {
    logger.warn(`hCaptcha verification request failed: ${(err as Error).message}`);
    return false;
  }
}
