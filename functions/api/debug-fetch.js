// Temporary diagnostic route — isolates whether outbound fetch() to an
// external host works at all from this Pages Functions deployment, and
// separately whether the Resend endpoint specifically responds. Delete
// once partner-application.js is confirmed working.
export async function onRequestGet({ env }) {
  const result = { hasKey: !!env.RESEND_API_KEY, steps: [] };

  try {
    const r1 = await fetch('https://api.github.com/zen');
    result.steps.push({ step: 'fetch github', status: r1.status, ok: r1.ok });
  } catch (err) {
    result.steps.push({ step: 'fetch github', error: String(err && err.message || err) });
  }

  try {
    const r2 = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY || 'missing'}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Kretase Partners <onboarding@resend.dev>',
        to: ['mwlih28@gmail.com'],
        subject: 'debug-fetch test',
        html: '<p>test</p>',
      }),
    });
    const text = await r2.text();
    result.steps.push({ step: 'fetch resend', status: r2.status, ok: r2.ok, body: text.slice(0, 500) });
  } catch (err) {
    result.steps.push({ step: 'fetch resend', error: String(err && err.message || err), stack: String(err && err.stack || '') });
  }

  return new Response(JSON.stringify(result, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
