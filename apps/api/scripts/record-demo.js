const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.argv[2] || '/tmp/kretase-demo-video';
const BASE = 'http://127.0.0.1:5173';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const LOGO_B64 = fs.readFileSync(
  path.join(__dirname, '../../web/public/brand/kretase-logo-128.png')
).toString('base64');
const LOGO_URI = `data:image/png;base64,${LOGO_B64}`;

// ── Motion-graphics layer injected into every document ──────────────────────
// A DOM-rendered cursor + click ripple + caption pill + full-screen crossfade
// veil. Playwright's video capture never shows the real OS cursor, so without
// this every click looks like a jump-cut. addInitScript re-runs on every new
// document (including full page reloads), so it survives goto() calls too.
const INIT_SCRIPT = `
(() => {
  // Define the window.__* API first and make every element lookup inside it
  // null-safe. addInitScript can fire before document.documentElement/body
  // exist, so DOM mounting below is retried via rAF — callers must never
  // throw just because mount() hasn't landed yet.
  window.__setCursor = (x, y) => {
    window.__cx = x; window.__cy = y;
    const c = document.getElementById('__demo-cursor');
    if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; }
  };
  window.__ripple = (x, y) => {
    const r = document.getElementById('__demo-ripple');
    if (!r) return;
    r.style.left = x + 'px'; r.style.top = y + 'px';
    r.classList.remove('fire'); void r.offsetWidth; r.classList.add('fire');
  };
  window.__caption = (text) => {
    const c = document.getElementById('__demo-caption');
    if (!c) return;
    c.querySelector('.txt').textContent = text;
    c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
  };
  window.__captionHide = () => {
    const c = document.getElementById('__demo-caption');
    if (c) c.classList.remove('show');
  };
  window.__veilShow = () => {
    const v = document.getElementById('__demo-veil');
    if (v) v.classList.remove('hidden');
  };
  window.__veilHide = () => {
    const v = document.getElementById('__demo-veil');
    if (v) v.classList.add('hidden');
  };

  const mountStyle = () => {
    if (!document.head && !document.documentElement) { requestAnimationFrame(mountStyle); return; }
    const style = document.createElement('style');
    style.textContent = \`
    #__demo-cursor {
      position: fixed; top: 0; left: 0; width: 22px; height: 22px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 30%, #fff, #d4d4d8 60%, #a1a1aa);
      border: 1px solid rgba(0,0,0,0.25);
      box-shadow: 0 2px 10px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.15);
      pointer-events: none; z-index: 2147483647;
      transform: translate(-50%, -50%);
      transition: left 550ms cubic-bezier(.22,.9,.25,1), top 550ms cubic-bezier(.22,.9,.25,1);
      will-change: left, top;
    }
    #__demo-ripple {
      position: fixed; top: 0; left: 0; width: 10px; height: 10px;
      border-radius: 50%; pointer-events: none; z-index: 2147483646;
      transform: translate(-50%, -50%);
      border: 2px solid rgba(255,255,255,0.9);
      box-shadow: 0 0 12px rgba(255,255,255,0.5);
      opacity: 0;
    }
    #__demo-ripple.fire {
      animation: __demoRipple 550ms cubic-bezier(.2,.8,.3,1);
    }
    @keyframes __demoRipple {
      0%   { opacity: 0.9; width: 10px; height: 10px; }
      100% { opacity: 0; width: 64px; height: 64px; }
    }
    #__demo-caption {
      position: fixed; top: 26px; left: 50%; z-index: 2147483645;
      padding: 10px 18px; border-radius: 999px;
      background: rgba(10,10,12,0.88);
      border: 1px solid rgba(255,255,255,0.14);
      color: #fff; font: 600 15px/1.4 Inter, system-ui, sans-serif;
      letter-spacing: 0.01em;
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      opacity: 0; transform: translateX(-50%) translateY(-12px);
      transition: opacity 380ms ease, transform 380ms ease;
      backdrop-filter: blur(6px);
    }
    #__demo-caption.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    #__demo-caption .dot {
      display:inline-block; width:7px; height:7px; border-radius:50%;
      background:#4ade80; margin-right:9px; box-shadow:0 0 8px #4ade80;
    }
    #__demo-veil {
      position: fixed; inset: 0; background: #0a0a0c; z-index: 2147483647;
      opacity: 1; pointer-events: none; transition: opacity 420ms ease;
    }
    #__demo-veil.hidden { opacity: 0; }
    \`;
    (document.head || document.documentElement).appendChild(style);
  };
  mountStyle();

  const mount = () => {
    if (!document.body) { requestAnimationFrame(mount); return; }
    const cursor = document.createElement('div');
    cursor.id = '__demo-cursor';
    cursor.style.left = (window.__cx || window.innerWidth / 2) + 'px';
    cursor.style.top = (window.__cy || window.innerHeight / 2) + 'px';
    document.body.appendChild(cursor);

    const ripple = document.createElement('div');
    ripple.id = '__demo-ripple';
    document.body.appendChild(ripple);

    const caption = document.createElement('div');
    caption.id = '__demo-caption';
    caption.innerHTML = '<span class="dot"></span><span class="txt"></span>';
    document.body.appendChild(caption);

    // Every fresh document starts fully covered by the veil — this masks the
    // white/blank flash that happens mid-navigation before React mounts.
    // Callers explicitly fade it out once the page has settled.
    const veil = document.createElement('div');
    veil.id = '__demo-veil';
    document.body.appendChild(veil);
  };
  mount();
})();
`;

function introHTML(logoUri) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#0a0a0c;overflow:hidden;font-family:Inter,system-ui,sans-serif;}
    .grid{position:fixed;inset:0;opacity:.05;background-image:linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px);background-size:48px 48px;}
    .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}
    .logo{width:96px;height:96px;border-radius:22px;object-fit:contain;opacity:0;transform:scale(.7) translateY(10px);animation:pop 900ms cubic-bezier(.2,.9,.25,1.2) 200ms forwards;box-shadow:0 20px 60px rgba(255,255,255,.08);}
    .title{margin-top:28px;font-size:44px;font-weight:800;color:#fff;letter-spacing:-0.02em;opacity:0;transform:translateY(14px);animation:rise 700ms ease 700ms forwards;}
    .sub{margin-top:10px;font-size:16px;color:#8b8b93;opacity:0;transform:translateY(10px);animation:rise 700ms ease 1050ms forwards;}
    .bar{margin-top:38px;width:220px;height:2px;background:#242428;border-radius:2px;overflow:hidden;opacity:0;animation:rise 400ms ease 1350ms forwards;}
    .bar i{display:block;height:100%;width:100%;background:#fff;transform:scaleX(0);transform-origin:left;animation:load 1500ms ease 1450ms forwards;}
    @keyframes pop{to{opacity:1;transform:scale(1) translateY(0);}}
    @keyframes rise{to{opacity:1;transform:translateY(0);}}
    @keyframes load{to{transform:scaleX(1);}}
  </style></head><body>
    <div class="grid"></div>
    <div class="wrap">
      <img class="logo" src="${logoUri}" />
      <div class="title">Kretase</div>
      <div class="sub">Self-hosted, open-source game server panel</div>
      <div class="bar"><i></i></div>
    </div>
  </body></html>`;
}

function outroHTML(logoUri) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#0a0a0c;overflow:hidden;font-family:Inter,system-ui,sans-serif;}
    .grid{position:fixed;inset:0;opacity:.05;background-image:linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px);background-size:48px 48px;}
    .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;}
    .logo{width:72px;height:72px;border-radius:18px;object-fit:contain;opacity:0;transform:scale(.7);animation:pop 700ms cubic-bezier(.2,.9,.25,1.2) 150ms forwards;}
    .title{margin-top:22px;font-size:34px;font-weight:800;color:#fff;opacity:0;transform:translateY(12px);animation:rise 650ms ease 500ms forwards;}
    .sub{margin-top:10px;font-size:16px;color:#9a9aa2;opacity:0;transform:translateY(10px);animation:rise 650ms ease 800ms forwards;}
    .url{margin-top:26px;font:600 18px/1 "JetBrains Mono",monospace;color:#fff;padding:12px 22px;border:1px solid #26262b;border-radius:12px;background:#111113;opacity:0;transform:translateY(10px);animation:rise 650ms ease 1100ms forwards;}
    .badge{margin-top:20px;font-size:14px;color:#4ade80;opacity:0;transform:translateY(10px);animation:rise 650ms ease 1400ms forwards;}
    @keyframes pop{to{opacity:1;transform:scale(1);}}
    @keyframes rise{to{opacity:1;transform:translateY(0);}}
  </style></head><body>
    <div class="grid"></div>
    <div class="wrap">
      <img class="logo" src="${logoUri}" />
      <div class="title">Free &amp; Open Source</div>
      <div class="sub">A modern, self-hosted alternative to Pterodactyl</div>
      <div class="url">github.com/mwlih28/mc-manage-panel</div>
      <div class="badge">★ Star it on GitHub</div>
    </div>
  </body></html>`;
}

async function moveAndClick(page, locator, { glideMs = 550 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) { await locator.click(); return; }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(([x, y]) => window.__setCursor(x, y), [x, y]);
  await pause(glideMs);
  await page.mouse.move(x, y);
  await page.evaluate(([x, y]) => window.__ripple(x, y), [x, y]);
  await pause(140);
  await locator.click();
  await pause(280);
}

async function caption(page, text) {
  await page.evaluate((t) => window.__caption(t), text);
}
async function captionHide(page) {
  await page.evaluate(() => window.__captionHide());
}

async function fadeGoto(page, url) {
  await page.evaluate(() => window.__veilShow?.());
  await pause(430);
  await page.goto(url, { waitUntil: 'load' });
  // Fresh document — addInitScript just remounted the veil fully opaque.
  await pause(150);
  await page.evaluate(() => window.__veilHide());
  await pause(450);
}

async function clickTabByText(page, label) {
  const loc = page.locator('button', { hasText: label }).first();
  await moveAndClick(page, loc);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: OUT_DIR, size: { width: 1920, height: 1080 } },
  });
  await context.addInitScript(INIT_SCRIPT);
  // Google Fonts is unreachable through this sandbox's outbound proxy and
  // hangs ~13s before failing, which the page's 'load' event waits on since
  // it's a document subresource. Abort it instantly — the recording doesn't
  // need the exact webfont, system-ui fallback looks the same on screen.
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const page = await context.newPage();

  // ── Intro ────────────────────────────────────────────────
  await page.setContent(introHTML(LOGO_URI));
  await pause(3200);
  await page.evaluate(() => window.__veilShow?.());
  await pause(150);

  // ── Login ────────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await pause(150);
  await page.evaluate(() => window.__veilHide?.());
  await pause(700);
  await caption(page, 'Modern, self-hosted panel');

  const emailInput = page.locator('input[type="email"]');
  await moveAndClick(page, emailInput, { glideMs: 400 });
  await emailInput.pressSequentially('admin@example.com', { delay: 45 });
  await pause(300);
  const passInput = page.locator('input[type="password"]');
  await moveAndClick(page, passInput, { glideMs: 350 });
  await passInput.pressSequentially('Admin123!', { delay: 55 });
  await pause(400);
  await captionHide(page);
  await moveAndClick(page, page.locator('button[type="submit"]'));
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await pause(1500);

  // ── Dashboard ────────────────────────────────────────────
  await caption(page, 'Dashboard — live overview');
  await pause(1800);
  await page.mouse.wheel(0, 250);
  await pause(1600);
  await page.mouse.wheel(0, -250);
  await pause(800);
  await captionHide(page);

  // ── Servers list ─────────────────────────────────────────
  await moveAndClick(page, page.locator('nav a', { hasText: 'Servers' }).first());
  await page.waitForURL('**/servers');
  await pause(1600);
  await caption(page, 'All your servers, one list');
  await pause(1600);
  await captionHide(page);

  // ── Server detail ────────────────────────────────────────
  await moveAndClick(page, page.locator('text=My Minecraft Server').first());
  await page.waitForURL('**/servers/**');
  await pause(1200);
  await caption(page, 'Live console');
  await pause(4200);

  const cmdInput = page.locator('input[placeholder="Enter command..."]');
  await moveAndClick(page, cmdInput, { glideMs: 400 });
  await cmdInput.pressSequentially('tps', { delay: 90 });
  await pause(400);
  await moveAndClick(page, page.locator('button', { hasText: 'Send' }));
  await pause(3200);
  await captionHide(page);

  await clickTabByText(page, 'Stats');
  await caption(page, 'Resource usage in real time');
  await pause(2600);
  await captionHide(page);

  await clickTabByText(page, 'Players');
  await caption(page, 'Player activity & history');
  await pause(1800);
  await captionHide(page);

  await clickTabByText(page, 'Files');
  await caption(page, 'Built-in file manager');
  await pause(1000);
  const pluginsRow = page.locator('text=plugins').first();
  if (await pluginsRow.count()) {
    await moveAndClick(page, pluginsRow, { glideMs: 400 });
    await pause(1400);
  }
  await captionHide(page);

  await clickTabByText(page, 'Backups');
  await pause(1600);

  await clickTabByText(page, 'Console');
  await pause(1200);

  // ── Tools ────────────────────────────────────────────────
  await caption(page, 'AI-assisted tools');
  await moveAndClick(page, page.locator('nav a', { hasText: 'MOTD Generator' }).first());
  await page.waitForURL('**/tools/motd-generator');
  await pause(2000);
  await moveAndClick(page, page.locator('nav a', { hasText: 'Logo Generator' }).first());
  await page.waitForURL('**/tools/logo-generator');
  await pause(2000);
  await captionHide(page);

  // ── Admin panel ──────────────────────────────────────────
  await fadeGoto(page, `${BASE}/admin`);
  await caption(page, 'Full admin control');
  await pause(2000);
  await captionHide(page);

  const adminNav = async (label, urlPart) => {
    await moveAndClick(page, page.locator('aside a, aside button', { hasText: label }).first());
    await page.waitForURL(`**${urlPart}`);
    await pause(1600);
  };

  await adminNav('Servers', '/admin/servers');
  await adminNav('Users', '/admin/users');
  await adminNav('Nodes', '/admin/nodes');
  await adminNav('Eggs', '/admin/eggs');
  await adminNav('Activity', '/admin/activity');
  await adminNav('Settings', '/admin/settings');
  await pause(1000);

  // ── Outro ────────────────────────────────────────────────
  await page.evaluate(() => window.__veilShow());
  await pause(450);
  await page.setContent(outroHTML(LOGO_URI));
  await pause(3600);

  const videoPath = await page.video().path();
  await context.close();
  await browser.close();
  console.log('VIDEO_PATH=' + videoPath);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
