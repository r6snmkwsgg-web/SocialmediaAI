/**
 * The app icons for phones' home screens, drawn from app/icon.svg so
 * there's one logo: a plain square at 192 and 512 pixels, a "maskable"
 * one with room for Android to crop it round, and Apple's 180.
 *
 *   pnpm icons
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const svg = readFileSync("app/icon.svg", "utf8");
// the maskable one keeps the hook inside the middle 60%, where every crop shape leaves it whole
const padded = svg.replace('viewBox="0 0 32 32"', 'viewBox="-11 -11 54 54"').replace('<rect width="32" height="32"', '<rect x="-11" y="-11" width="54" height="54"');

const out: [string, number, string][] = [
  ["public/icons/icon-192.png", 192, svg],
  ["public/icons/icon-512.png", 512, svg],
  ["public/icons/maskable-512.png", 512, padded],
  ["app/apple-icon.png", 180, padded.replace('viewBox="-11 -11 54 54"', 'viewBox="-4 -4 40 40"').replace('<rect x="-11" y="-11" width="54" height="54"', '<rect x="-4" y="-4" width="40" height="40"')],
];

async function main() {
  mkdirSync("public/icons", { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const page = await browser.newPage();
  for (const [path, size, art] of out) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0">${art.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path, clip: { x: 0, y: 0, width: size, height: size }, omitBackground: false });
    console.log(path);
  }
  await browser.close();
}

void main();
