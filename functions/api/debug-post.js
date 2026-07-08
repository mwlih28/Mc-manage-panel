// Temporary diagnostic route — confirms whether POST requests reach Pages
// Functions at all, isolated from any Resend/fetch logic. Delete once
// partner-application.js is confirmed working.
export async function onRequestPost({ request }) {
  let body = null;
  try { body = await request.json(); } catch {}
  return new Response(JSON.stringify({ ok: true, received: body }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
