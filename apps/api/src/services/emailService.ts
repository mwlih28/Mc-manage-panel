import nodemailer from 'nodemailer';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

// ── Panel SMTP (configured by panel admin in Admin → Settings) ─────────
async function getPanelSmtpConf(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: 'smtp.' } } });
  const conf: Record<string, string> = {};
  for (const r of rows) conf[r.key] = r.value;
  return conf;
}

function makeTransport(conf: Record<string, string>) {
  if (!conf['smtp.host'] || !conf['smtp.user'] || !conf['smtp.pass']) return null;
  const port = parseInt(conf['smtp.port'] || '587', 10);
  return nodemailer.createTransport({
    host: conf['smtp.host'],
    port,
    secure: port === 465,
    auth: { user: conf['smtp.user'], pass: conf['smtp.pass'] },
    tls: { rejectUnauthorized: false },
  });
}

function updateHtml(version: string, changelogUrl?: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Update Available</title></head>
<body style="margin:0;padding:0;background:#0a0a0c;font-family:system-ui,-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0c;padding:40px 20px;">
<tr><td align="center">
  <table width="520" cellpadding="0" cellspacing="0" style="background:#111113;border:1px solid #1e1e22;border-radius:12px;overflow:hidden;">
    <tr><td style="background:linear-gradient(135deg,#1a2a3a,#111827);padding:32px 36px;text-align:center;">
      <div style="display:inline-block;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;margin-bottom:16px;">
        <span style="font-size:28px;">🚀</span>
      </div>
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Kretase</h1>
      <p style="margin:6px 0 0;color:#93c5fd;font-size:13px;">Update Available — ${version}</p>
    </td></tr>
    <tr><td style="padding:32px 36px;">
      <p style="margin:0 0 16px;color:#e4e4e7;font-size:15px;">A new version of Kretase is available!</p>
      <p style="margin:0 0 20px;color:#a1a1aa;font-size:14px;line-height:1.6;">
        Run the update script to get the latest features, bug fixes, and security improvements — your data won't be affected.
      </p>
      <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <p style="margin:0 0 8px;color:#93c5fd;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Update Command</p>
        <code style="color:#86efac;font-size:12px;font-family:monospace;word-break:break-all;">bash &lt;(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/update-panel.sh)</code>
      </div>
      ${changelogUrl ? `<div style="margin:20px 0;"><a href="${changelogUrl}" style="display:inline-block;background:#2563eb;color:#fff;font-size:13px;font-weight:600;text-decoration:none;padding:10px 20px;border-radius:8px;">View Changelog</a></div>` : ''}
      <p style="margin:0;color:#71717a;font-size:13px;">The Kretase Team</p>
    </td></tr>
    <tr><td style="padding:16px 36px;background:#0d0f11;border-top:1px solid #1e1e22;text-align:center;">
      <p style="margin:0;color:#52525b;font-size:11px;">You're receiving this because you opted in for update notifications during installation.</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

function resetPasswordHtml(resetUrl: string, appName: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Reset your password</title></head>
<body style="margin:0;padding:0;background:#0a0a0c;font-family:system-ui,-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0c;padding:40px 20px;">
<tr><td align="center">
  <table width="520" cellpadding="0" cellspacing="0" style="background:#111113;border:1px solid #1e1e22;border-radius:12px;overflow:hidden;">
    <tr><td style="background:linear-gradient(135deg,#1a2a3a,#111827);padding:32px 36px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">${appName}</h1>
      <p style="margin:6px 0 0;color:#93c5fd;font-size:13px;">Password Reset Request</p>
    </td></tr>
    <tr><td style="padding:32px 36px;">
      <p style="margin:0 0 16px;color:#e4e4e7;font-size:15px;">We received a request to reset your password.</p>
      <p style="margin:0 0 24px;color:#a1a1aa;font-size:14px;line-height:1.6;">
        Click the button below to choose a new password. This link expires in 1 hour. If you didn't request this, you can safely ignore this email.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${resetUrl}" style="display:inline-block;background:#2563eb;color:#fff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:8px;">Reset Password</a>
      </div>
      <p style="margin:0;color:#71717a;font-size:12px;word-break:break-all;">Or paste this link in your browser: ${resetUrl}</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

export async function sendPasswordResetEmail(to: string, resetUrl: string, appName = 'Kretase'): Promise<boolean> {
  try {
    const conf = await getPanelSmtpConf();
    const transport = makeTransport(conf);
    if (!transport) {
      logger.warn('Password reset email not sent — panel SMTP is not configured');
      return false;
    }
    const from = conf['smtp.from'] || conf['smtp.user'];
    await transport.sendMail({
      from: `"${appName}" <${from}>`,
      to,
      subject: `Reset your ${appName} password`,
      html: resetPasswordHtml(resetUrl, appName),
      text: `Reset your ${appName} password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
    });
    logger.info(`Password reset email sent to ${to}`);
    return true;
  } catch (err) {
    logger.warn(`Failed to send password reset email to ${to}: ${(err as Error).message}`);
    return false;
  }
}

export async function sendUpdateNotification(to: string, version: string, changelogUrl?: string): Promise<boolean> {
  try {
    const conf = await getPanelSmtpConf();
    const transport = makeTransport(conf);
    if (!transport) return false;
    const from = conf['smtp.from'] || conf['smtp.user'];
    await transport.sendMail({
      from: `"Kretase" <${from}>`,
      to,
      subject: `Kretase ${version} is available`,
      html: updateHtml(version, changelogUrl),
      text: `Kretase ${version} is now available!\n\nUpdate: bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/update-panel.sh)`,
    });
    return true;
  } catch (err) {
    logger.warn(`Failed to send update notification to ${to}: ${(err as Error).message}`);
    return false;
  }
}
