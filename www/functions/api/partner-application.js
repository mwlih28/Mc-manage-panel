// Cloudflare Pages Function — POST /api/partner-application
//
// Sends the Certified Partner application form (partners.html) to
// mwlih28@gmail.com via Resend, server-side. Requires a RESEND_API_KEY
// environment variable set on the Pages project (Settings > Environment
// variables); RESEND_FROM is optional and defaults to Resend's shared
// sandbox sender, which delivers fine to a Resend account's own owner
// email without needing a verified sending domain.
const TO_EMAIL = 'mwlih28@gmail.com';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const company = String(body.company || '').trim().slice(0, 200);
  const name = String(body.name || '').trim().slice(0, 200);
  const email = String(body.email || '').trim().slice(0, 200);
  const url = String(body.url || '').trim().slice(0, 300);
  const why = String(body.why || '').trim().slice(0, 4000);
  // Hidden field real applicants never see or fill in — a non-empty value
  // means a bot filled every input on the page. Report success so the bot
  // doesn't retry, but skip actually sending anything.
  const honeypot = String(body.website || '').trim();
  if (honeypot) return json({ ok: true });

  if (!company || !name || !email || !url || !why) {
    return json({ error: 'Missing required fields' }, 400);
  }
  if (!EMAIL_RE.test(email)) {
    return json({ error: 'Invalid email address' }, 400);
  }

  if (!env.RESEND_API_KEY) {
    return json({ error: 'Email is not configured on this deployment' }, 500);
  }

  const resendResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM || 'Kretase Partners <onboarding@resend.dev>',
      to: [TO_EMAIL],
      reply_to: email,
      subject: `Kretase Partner Application — ${company}`,
      html: `
        <p><strong>Company:</strong> ${escapeHtml(company)}</p>
        <p><strong>Contact:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Panel URL:</strong> ${escapeHtml(url)}</p>
        <p><strong>Why applying:</strong><br>${escapeHtml(why).replace(/\n/g, '<br>')}</p>
      `.trim(),
    }),
  });

  if (!resendResp.ok) {
    const detail = await resendResp.text().catch(() => '');
    return json({ error: 'Failed to send email', detail }, 502);
  }

  return json({ ok: true });
}

export async function onRequestGet() {
  return json({ error: 'Method not allowed' }, 405);
}
