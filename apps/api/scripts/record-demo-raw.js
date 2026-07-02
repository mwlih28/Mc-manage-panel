// Plain, unedited walkthrough recording — no cursor overlay, no captions, no
// transitions. Meant as raw b-roll for editing in an external tool (Premiere/
// CapCut/etc.), not as a finished deliverable itself.
const { chromium } = require('playwright');

const OUT_DIR = process.argv[2] || '/tmp/kretase-demo-raw';
const BASE = 'http://127.0.0.1:5173';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickTabByText(page, label) {
  await page.locator('button', { hasText: label }).first().click();
  await pause(2000);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: OUT_DIR, size: { width: 1920, height: 1080 } },
  });
  // Google Fonts is unreachable through this sandbox's proxy and hangs ~13s
  // before failing, which the page's 'load' event waits on — abort it.
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const page = await context.newPage();

  // ── Login ────────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await pause(1000);
  await page.locator('input[type="email"]').fill('admin@example.com');
  await pause(300);
  await page.locator('input[type="password"]').fill('Admin123!');
  await pause(500);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await pause(2500);

  // ── Dashboard ────────────────────────────────────────────
  await page.mouse.wheel(0, 300);
  await pause(1800);
  await page.mouse.wheel(0, -300);
  await pause(1200);

  // ── Servers list ─────────────────────────────────────────
  await page.locator('nav a', { hasText: 'Servers' }).first().click();
  await page.waitForURL('**/servers');
  await pause(2200);

  // ── Server detail ────────────────────────────────────────
  await page.locator('text=My Minecraft Server').first().click();
  await page.waitForURL('**/servers/**');
  await pause(1500);

  // Console tab (default) — let live output stream in
  await pause(5000);
  await page.locator('input[placeholder="Enter command..."]').fill('tps');
  await pause(500);
  await page.locator('button', { hasText: 'Send' }).click();
  await pause(3500);

  await clickTabByText(page, 'Stats');
  await pause(2200);
  await clickTabByText(page, 'Players');
  await clickTabByText(page, 'Files');
  const pluginsRow = page.locator('text=plugins').first();
  if (await pluginsRow.count()) {
    await pluginsRow.click();
    await pause(1800);
  }
  await clickTabByText(page, 'Backups');
  await clickTabByText(page, 'Worlds');
  await clickTabByText(page, 'Console');
  await pause(1500);

  // ── Tools ────────────────────────────────────────────────
  await page.goto(`${BASE}/tools/motd-generator`, { waitUntil: 'load' });
  await pause(2500);
  await page.goto(`${BASE}/tools/logo-generator`, { waitUntil: 'load' });
  await pause(2500);

  // ── Admin panel ──────────────────────────────────────────
  await page.goto(`${BASE}/admin`, { waitUntil: 'load' });
  await pause(2500);
  await page.goto(`${BASE}/admin/servers`, { waitUntil: 'load' });
  await pause(2200);
  await page.goto(`${BASE}/admin/users`, { waitUntil: 'load' });
  await pause(2200);
  await page.goto(`${BASE}/admin/nodes`, { waitUntil: 'load' });
  await pause(2200);
  await page.goto(`${BASE}/admin/eggs`, { waitUntil: 'load' });
  await pause(2200);
  await page.goto(`${BASE}/admin/activity`, { waitUntil: 'load' });
  await pause(2200);
  await page.goto(`${BASE}/admin/settings`, { waitUntil: 'load' });
  await pause(2500);

  const videoPath = await page.video().path();
  await context.close();
  await browser.close();
  console.log('VIDEO_PATH=' + videoPath);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
