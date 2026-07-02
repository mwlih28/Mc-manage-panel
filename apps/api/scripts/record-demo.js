const { chromium } = require('playwright');
const path = require('path');

const OUT_DIR = process.argv[2] || '/tmp/kretase-demo-video';
const BASE = 'http://127.0.0.1:5173';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickTab(page, label) {
  await page.locator('button', { hasText: label }).first().click();
  await pause(2200);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: OUT_DIR, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();

  // ── Login ────────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await pause(1500);
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
  await pause(4500);
  await page.locator('input[placeholder="Enter command..."]').fill('tps');
  await pause(500);
  await page.locator('button', { hasText: 'Send' }).click();
  await pause(3500);

  // Stats
  await clickTab(page, 'Stats');
  await pause(2000);

  // Players
  await clickTab(page, 'Players');

  // Files
  await clickTab(page, 'Files');
  const pluginsRow = page.locator('text=plugins').first();
  if (await pluginsRow.count()) {
    await pluginsRow.click();
    await pause(1800);
  }

  // Backups
  await clickTab(page, 'Backups');

  // Back to console for a moment
  await clickTab(page, 'Console');

  // ── Tools ────────────────────────────────────────────────
  await page.locator('nav a', { hasText: 'MOTD Generator' }).first().click();
  await page.waitForURL('**/tools/motd-generator');
  await pause(2000);
  await page.locator('nav a', { hasText: 'Logo Generator' }).first().click();
  await page.waitForURL('**/tools/logo-generator');
  await pause(2000);

  // ── Admin panel ──────────────────────────────────────────
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  await pause(2200);

  const adminNav = async (label, urlPart) => {
    await page.locator('aside a, aside button', { hasText: label }).first().click();
    await page.waitForURL(`**${urlPart}`);
    await pause(1800);
  };

  await adminNav('Servers', '/admin/servers');
  await adminNav('Users', '/admin/users');
  await adminNav('Nodes', '/admin/nodes');
  await adminNav('Eggs', '/admin/eggs');
  await adminNav('Activity', '/admin/activity');
  await adminNav('Settings', '/admin/settings');
  await pause(1500);

  const videoPath = await page.video().path();
  await context.close();
  await browser.close();
  console.log('VIDEO_PATH=' + videoPath);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
