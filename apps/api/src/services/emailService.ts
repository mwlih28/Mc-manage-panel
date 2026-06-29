import nodemailer from 'nodemailer';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

async function getSmtpConf(): Promise<Record<string, string>> {
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

function thankYouHtml(name: string, serverIp: string): string {
  const displayName = name || 'there';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Thank you!</title></head>
<body style="margin:0;padding:0;background:#0a0a0c;font-family:system-ui,-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0c;padding:40px 20px;">
<tr><td align="center">
  <table width="520" cellpadding="0" cellspacing="0" style="background:#111113;border:1px solid #1e1e22;border-radius:12px;overflow:hidden;">
    <tr><td style="background:linear-gradient(135deg,#1a3a2a,#112218);padding:32px 36px;text-align:center;">
      <div style="display:inline-block;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;margin-bottom:16px;">
        <span style="font-size:28px;">🛡️</span>
      </div>
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">MC Manage Panel</h1>
      <p style="margin:6px 0 0;color:#86efac;font-size:13px;">Game Server Management Platform</p>
    </td></tr>
    <tr><td style="padding:32px 36px;">
      <p style="margin:0 0 16px;color:#e4e4e7;font-size:15px;">Hi ${displayName},</p>
      <p style="margin:0 0 16px;color:#a1a1aa;font-size:14px;line-height:1.6;">
        Thank you for installing <strong style="color:#e4e4e7;">MC Manage Panel</strong>! We hope it makes managing your game servers easier and more enjoyable.
      </p>
      <div style="background:#0d1f15;border:1px solid #1a3a2a;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <p style="margin:0 0 8px;color:#86efac;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Your Installation</p>
        <p style="margin:0;color:#d4d4d8;font-size:13px;font-family:monospace;">Server IP: ${serverIp}</p>
      </div>
      <p style="margin:0 0 16px;color:#a1a1aa;font-size:14px;line-height:1.6;">
        If you run into any issues, check the documentation or open an issue on GitHub.
      </p>
      <div style="margin:24px 0;">
        <a href="https://github.com/mwlih28/mc-manage-panel" style="display:inline-block;background:#16a34a;color:#fff;font-size:13px;font-weight:600;text-decoration:none;padding:10px 20px;border-radius:8px;">View on GitHub</a>
      </div>
      <p style="margin:0;color:#71717a;font-size:13px;line-height:1.6;">Cheers,<br><strong style="color:#a1a1aa;">The MC Manage Panel Team</strong></p>
    </td></tr>
    <tr><td style="padding:16px 36px;background:#0d0f11;border-top:1px solid #1e1e22;text-align:center;">
      <p style="margin:0;color:#52525b;font-size:11px;">You received this email because you installed MC Manage Panel on ${serverIp}.</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
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
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">MC Manage Panel</h1>
      <p style="margin:6px 0 0;color:#93c5fd;font-size:13px;">Update Available — ${version}</p>
    </td></tr>
    <tr><td style="padding:32px 36px;">
      <p style="margin:0 0 16px;color:#e4e4e7;font-size:15px;">A new version of MC Manage Panel is available!</p>
      <p style="margin:0 0 20px;color:#a1a1aa;font-size:14px;line-height:1.6;">
        Run the update script to get the latest features, bug fixes, and security improvements — your data won't be affected.
      </p>
      <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <p style="margin:0 0 8px;color:#93c5fd;font-size:12px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">Update Command</p>
        <code style="color:#86efac;font-size:12px;font-family:monospace;word-break:break-all;">bash &lt;(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/update-panel.sh)</code>
      </div>
      ${changelogUrl ? `<div style="margin:20px 0;"><a href="${changelogUrl}" style="display:inline-block;background:#2563eb;color:#fff;font-size:13px;font-weight:600;text-decoration:none;padding:10px 20px;border-radius:8px;">View Changelog</a></div>` : ''}
      <p style="margin:0;color:#71717a;font-size:13px;">The MC Manage Panel Team</p>
    </td></tr>
    <tr><td style="padding:16px 36px;background:#0d0f11;border-top:1px solid #1e1e22;text-align:center;">
      <p style="margin:0;color:#52525b;font-size:11px;">You're receiving this because you opted in for update notifications during installation.</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

export async function sendThankYouEmail(to: string, name: string, serverIp: string): Promise<boolean> {
  try {
    const conf = await getSmtpConf();
    const transport = makeTransport(conf);
    if (!transport) return false;
    const from = conf['smtp.from'] || conf['smtp.user'];
    await transport.sendMail({
      from: `"MC Manage Panel" <${from}>`,
      to,
      subject: 'Thank you for installing MC Manage Panel!',
      html: thankYouHtml(name, serverIp),
      text: `Hi ${name || 'there'},\n\nThank you for installing MC Manage Panel on ${serverIp}!\n\nUpdate command: bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/update-panel.sh)\n\nCheers,\nThe MC Manage Panel Team`,
    });
    logger.info(`Thank-you email sent to ${to}`);
    return true;
  } catch (err) {
    logger.warn(`Failed to send thank-you email to ${to}: ${(err as Error).message}`);
    return false;
  }
}

export async function sendOwnerNotification(conf: Record<string, string>, name: string, email: string, serverIp: string, domain: string): Promise<boolean> {
  try {
    const transport = makeTransport(conf);
    if (!transport) return false;
    const ownerEmail = conf['smtp.owner_email'];
    if (!ownerEmail) return false;
    const from = conf['smtp.from'] || conf['smtp.user'];
    await transport.sendMail({
      from: `"MC Panel Registry" <${from}>`,
      to: ownerEmail,
      subject: `New installation: ${domain || serverIp}`,
      text: `New MC Manage Panel installation registered.\n\nName: ${name || '(not provided)'}\nEmail: ${email}\nServer IP: ${serverIp}\nDomain: ${domain || '—'}\nTime: ${new Date().toISOString()}`,
    });
    return true;
  } catch (err) {
    logger.warn(`Failed to send owner notification: ${(err as Error).message}`);
    return false;
  }
}

export async function sendUpdateNotification(to: string, version: string, changelogUrl?: string): Promise<boolean> {
  try {
    const conf = await getSmtpConf();
    const transport = makeTransport(conf);
    if (!transport) return false;
    const from = conf['smtp.from'] || conf['smtp.user'];
    await transport.sendMail({
      from: `"MC Manage Panel" <${from}>`,
      to,
      subject: `MC Manage Panel ${version} is available`,
      html: updateHtml(version, changelogUrl),
      text: `MC Manage Panel ${version} is now available!\n\nUpdate: bash <(curl -fsSL https://raw.githubusercontent.com/mwlih28/mc-manage-panel/main/scripts/update-panel.sh)`,
    });
    return true;
  } catch (err) {
    logger.warn(`Failed to send update notification to ${to}: ${(err as Error).message}`);
    return false;
  }
}
