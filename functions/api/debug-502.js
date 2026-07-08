// Temporary diagnostic — tests whether Cloudflare's edge replaces a
// Worker-returned 502 body with its own generic error page, independent of
// any fetch/Resend logic. Delete once partner-application.js is confirmed.
export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: false, custom: 'this body should survive' }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' },
  });
}
