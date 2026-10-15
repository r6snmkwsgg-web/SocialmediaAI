/**
 * Screenshots of every page, at desktop and phone sizes, and the LIVE
 * games at full 1080×1920 in each state, into docs/screens:
 *
 *   pnpm screens [http://localhost:3000] [site] [app] [games]
 *
 * Naming parts takes only those; with none named, it takes them all.
 * Needs the app running with HOOKLINE_DEV_LOGIN=1 (it signs in as a new
 * test account), and a database. The app's screens show that account's
 * real state: a new account's empty states, its first Shorts, and so on.
 * With SCREENS_ADMIN set to an email in ADMIN_EMAILS, it signs in as that
 * too and takes the admin page.
 */
import { mkdirSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const ONLY = process.argv.slice(3);
const wanted = (part: string) => ONLY.length === 0 || ONLY.includes(part);
const OUT = "docs/screens";
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const settle = (page: Page, ms = 2500) => page.waitForTimeout(ms);

/** Next's error overlay, which the development server can show for a moment while it rebuilds. */
const overlay = (page: Page) =>
  page.evaluate(() => {
    const html = document.querySelector("nextjs-portal")?.shadowRoot?.innerHTML ?? "";
    const text = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
    return /Runtime|Unhandled|Build Error|\b[1-9]\d* Issues?\b/.test(text);
  });

async function shoot(page: Page, name: string, full = true) {
  // a page caught mid-rebuild gets one reload before it counts
  if (await overlay(page)) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await settle(page, 3500);
    if (await overlay(page)) console.warn(`${name}: the page shows an error`);
  }
  // JPEG: the film grain makes PNGs of these pages several times bigger for no visible gain
  await page.screenshot({ path: `${OUT}/${name}.jpg`, fullPage: full, type: "jpeg", quality: 82 });
  console.log(`${OUT}/${name}.jpg`);
}

async function site(browser: Browser) {
  for (const [size, tag] of [[DESKTOP, "desktop"], [PHONE, "phone"]] as const) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: tag === "phone" ? 2 : 1 });
    const page = await ctx.newPage();
    for (const [path, name] of [["/", "home"], ["/shorts", "shorts"], ["/live", "live"], ["/trends", "trends"], ["/login", "login"], ["/privacy", "privacy"], ["/terms", "terms"]]) {
      await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
      await settle(page, 3500);
      await shoot(page, `${tag}-site-${name}`);
    }
    await ctx.close();
  }
}

async function signUp(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#dev-email", `screens-${Date.now()}@hookline.local`);
  await page.click("text=Sign in here");
  await page.waitForURL(/welcome/);
  await page.waitForSelector("button[value=both]");
  await settle(page, 1000);
  await shoot(page, "desktop-app-welcome", false);
  await page.click("button[value=both]");
  await page.waitForURL(/step=connect/);
  await page.waitForSelector("text=Skip for now");
  await settle(page, 1000);
  await shoot(page, "desktop-app-welcome-connect", false);
  await page.click("text=Skip for now");
  await page.waitForURL((u) => u.pathname === "/app");
  return page;
}

async function app(browser: Browser) {
  const ctx = await browser.newContext({ viewport: DESKTOP });
  ctx.setDefaultTimeout(90_000);
  const page = await signUp(ctx);
  const pages: [string, string][] = [
    ["/app", "home"],
    ["/app/shorts", "shorts"],
    ["/app/shorts/calendar", "shorts-calendar"],
    ["/app/shorts/library", "shorts-library"],
    ["/app/live", "live"],
    ["/app/trends", "trends"],
    ["/app/earnings", "earnings"],
    ["/app/notifications", "notifications"],
    ["/app/settings", "settings"],
    ["/app/settings/billing", "billing"],
  ];
  for (const [path, name] of pages) {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
    await settle(page, 3500);
    await shoot(page, `desktop-app-${name}`);
  }
  // a Short said yes to, on its own page, and the palette over Home
  await page.goto(`${BASE}/app/shorts`, { waitUntil: "domcontentloaded" });
  await settle(page, 3500);
  await page.keyboard.press("ArrowRight");
  await settle(page, 2500);
  const first = page.locator('a[href^="/app/shorts/"]').filter({ hasNotText: /queue|calendar|library/i }).first();
  if (await first.count()) {
    await page.goto(BASE + (await first.getAttribute("href")), { waitUntil: "domcontentloaded" });
    await settle(page, 3500);
    await shoot(page, "desktop-app-short");
  }
  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  await settle(page, 3000);
  await page.keyboard.press("Control+k");
  await settle(page, 600);
  await shoot(page, "desktop-app-palette", false);
  await page.keyboard.press("Escape");

  const state = await ctx.storageState();
  const phone = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, storageState: state });
  const pp = await phone.newPage();
  // a phone's screen as it looks, tab bar at the bottom
  for (const [path, name] of pages) {
    await pp.goto(BASE + path, { waitUntil: "domcontentloaded" });
    await settle(pp, 3500);
    await shoot(pp, `phone-app-${name}`, false);
  }
  const dark = await browser.newContext({ viewport: DESKTOP, colorScheme: "dark", storageState: state });
  const dp = await dark.newPage();
  for (const [path, name] of [["/app", "home"], ["/app/shorts", "shorts"], ["/app/earnings", "earnings"]]) {
    await dp.goto(BASE + path, { waitUntil: "domcontentloaded" });
    await settle(dp, 3500);
    await shoot(dp, `desktop-app-${name}-dark`);
  }
  await Promise.all([ctx.close(), phone.close(), dark.close()]);

  const operator = process.env.SCREENS_ADMIN;
  if (operator) {
    const ac = await browser.newContext({ viewport: DESKTOP });
    const ap = await ac.newPage();
    await ap.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await ap.fill("#dev-email", operator);
    await ap.click("text=Sign in here");
    await ap.waitForURL((u) => u.pathname.startsWith("/app"));
    await ap.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await settle(ap, 3500);
    await shoot(ap, "desktop-admin");
    await ac.close();
  }
}

/** Each game at the size it's streamed: counting down, mid-round, and the vote between rounds. */
async function games(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 } });
  for (const game of ["battle", "rivals", "race", "royale"]) {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/live/play?demo=1&clean=1&game=${game}`, { waitUntil: "domcontentloaded" });
    await settle(page, 2500);
    await shoot(page, `live-${game}-countdown`, false);
    await settle(page, 9000);
    await shoot(page, `live-${game}-playing`, false);
    // run the show forward to the end of the round (the dev build exposes it), then let the vote fill up
    const reached = await page.evaluate(() => {
      const s = (window as unknown as { __show?: { phase: string; update: (dt: number) => void } }).__show;
      if (!s) return false;
      for (let i = 0; i < 60 * 240 && s.phase !== "win"; i++) s.update(1 / 60);
      return s.phase === "win";
    });
    if (reached) {
      await settle(page, 3500);
      await shoot(page, `live-${game}-vote`, false);
    }
    await page.close();
  }
  await ctx.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  try {
    if (wanted("site")) await site(browser);
    if (wanted("app")) await app(browser);
    if (wanted("games")) await games(browser);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
