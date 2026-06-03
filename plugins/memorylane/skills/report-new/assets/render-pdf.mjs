#!/usr/bin/env node
/**
 * render-pdf.mjs — HTML -> faithful PDF via headless Chromium (Playwright).
 *
 * Why Chromium: the report is designed in a browser, so a Chromium print is
 * the only engine that reproduces the same CSS (gradients, chips, fixed-size
 * pages) pixel-for-pixel. Each `.page` is one A4-landscape sheet, so page
 * breaks are deterministic.
 *
 * Usage:
 *   node render-pdf.mjs <input.html> <output.pdf> [--portrait] [--shots <dir>]
 *
 * Exit codes: 0 ok · 2 overflow detected (PDF still written) · 1 hard error.
 * Prints a JSON verification report to stdout (page count, overflow pages).
 *
 * Requires Playwright. If absent, the caller (make-pdf.sh) falls back.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const input = args[0];
const output = args[1] || "report.pdf";
const portrait = args.includes("--portrait");
const shotsIdx = args.indexOf("--shots");
const shotsDir = shotsIdx >= 0 ? args[shotsIdx + 1] : null;

if (!input || !existsSync(input)) {
  console.error(`render-pdf: input HTML not found: ${input}`);
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  try { ({ chromium } = await import("playwright-core")); }
  catch {
    console.error("render-pdf: playwright not installed");
    process.exit(3); // distinct code so the wrapper can fall back
  }
}

// Try bundled Chromium first; fall back to an installed Chrome channel.
async function launch() {
  const tries = [{}, { channel: "chrome" }, { channel: "msedge" }];
  let lastErr;
  for (const opt of tries) {
    try { return await chromium.launch({ ...opt, args: ["--no-sandbox"] }); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

const browser = await launch();
const page = await browser.newPage();
await page.emulateMedia({ media: "print" });
await page.goto(pathToFileURL(resolve(input)).href, { waitUntil: "networkidle" });

// Verification: detect any fixed-size .page whose content overflows the sheet.
const verify = await page.evaluate(() => {
  const pages = [...document.querySelectorAll(".page:not(.page--flow)")];
  const overflow = [];
  pages.forEach((el, i) => {
    const over = el.scrollHeight - el.clientHeight;
    if (over > 2) overflow.push({ index: i, overflowPx: Math.round(over) });
  });
  return { pageElements: pages.length, flowPages: document.querySelectorAll(".page--flow").length, overflow };
});

// Optional per-page screenshots (useful to eyeball overflow before approval).
if (shotsDir) {
  mkdirSync(shotsDir, { recursive: true });
  await page.emulateMedia({ media: "screen" });
  const els = await page.$$(".page");
  for (let i = 0; i < els.length; i++) {
    await els[i].screenshot({ path: `${shotsDir}/page-${String(i + 1).padStart(2, "0")}.png` });
  }
  await page.emulateMedia({ media: "print" });
}

await page.pdf({
  path: output,
  printBackground: true,
  preferCSSPageSize: true,             // honour @page size (A4 landscape)
  format: portrait ? "A4" : undefined, // CSS @page wins when preferCSSPageSize
  landscape: !portrait,
  margin: { top: "0", right: "0", bottom: "0", left: "0" },
});

await browser.close();

const report = { ok: verify.overflow.length === 0, output, ...verify };
console.log(JSON.stringify(report, null, 2));
if (verify.overflow.length) {
  console.error(
    `render-pdf: ${verify.overflow.length} page(s) overflow the sheet — ` +
    `split their content across more .page blocks: ` +
    verify.overflow.map((o) => `#${o.index + 1} (+${o.overflowPx}px)`).join(", ")
  );
  process.exit(2);
}
process.exit(0);
