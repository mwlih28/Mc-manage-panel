// Cloudflare Pages Function — POST /api/partner-application
//
// Sends the Certified Partner application form (partners.html) to
// RESEND_TO (falls back to mwlih28@gmail.com) via Resend, server-side.
// Requires a RESEND_API_KEY environment variable set on the Pages project
// (Settings > Environment variables) — updating that value alone doesn't
// take effect until a new deployment ships, since each deployment binds
// its own env snapshot.
//
// Every response here uses HTTP 200 with an {ok, error} envelope, even for
// failures. Cloudflare's edge silently replaces any Worker-returned 5xx
// response body with its own generic "error code: 5xx" page — confirmed by
// testing a bare `return new Response(json, {status: 502})` with no logic
// at all and getting the same stripped page back — so a real 4xx/5xx here
// would make every failure indistinguishable from a routing outage.
const TO_EMAIL_DEFAULT = 'mwlih28@gmail.com';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function onRequestPost(context) {
  try {
    return await handlePost(context);
  } catch (err) {
    return json({ ok: false, error: 'Unexpected server error', detail: String(err && err.message || err) });
  }
}

async function handlePost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' });
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
    return json({ ok: false, error: 'Missing required fields' });
  }
  if (!EMAIL_RE.test(email)) {
    return json({ ok: false, error: 'Invalid email address' });
  }

  if (!env.RESEND_API_KEY) {
    return json({ ok: false, error: 'Email is not configured on this deployment' });
  }

  let resendResp;
  try {
    resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM || 'Kretase Partners <onboarding@resend.dev>',
        to: [env.RESEND_TO || TO_EMAIL_DEFAULT],
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
  } catch (err) {
    return json({ ok: false, error: 'Could not reach Resend', detail: String(err && err.message || err) });
  }

  if (!resendResp.ok) {
    const detail = await resendResp.text().catch(() => '');
    return json({ ok: false, error: 'Failed to send email', detail });
  }

  return json({ ok: true });
}

export async function onRequestGet() {
  return json({ ok: false, error: 'Method not allowed' });
}
