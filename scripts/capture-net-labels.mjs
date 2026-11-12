import { chromium } from "playwright";
import { buildReport } from "../src/git.js";
import { serve } from "../src/server.js";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

if (!process.argv[2])
  throw new Error("Usage: node scripts/capture-net-labels.mjs PATH_TO_HACKRF_CACHE");
const out = "docs/media/net-labels";
await mkdir(out, { recursive: true });
const report = buildReport(
  process.argv[2],
  "f6598e7b14b7ec539126479e9c6d095c668a534e",
  "3bdc5547004c8244de5f37104410c363854e5634",
);
const server = await serve(report);
const browser = await chromium.launch({
  executablePath: process.env.BOARDMAP_BROWSER || undefined,
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator(".tile").first().waitFor();
  assert.equal(await page.locator("#stats .electrical strong").innerText(), "105");
  assert.equal(report.stats.changed, 389);
  assert.equal(report.stats.affected, 58);
  await page.mouse.move(1420, 890);
  await page.screenshot({ path: `${out}/hackrf-map.png` });

  await page.locator("#renames-toggle").click();
  assert.equal(await page.locator("#renames li").count(), 6);
  assert.equal(report.netRenames.length, 3);
  await page.screenshot({ path: `${out}/hackrf-labels.png` });
  await page.keyboard.press("Escape");

  const part = report.parts.find((p) => p.ref === "R62");
  await page.locator(`.part-row[data-id=${JSON.stringify(part.id)}]`).click();
  assert.equal(await page.locator(".priority-tag").innerText(), "Metadata");
  assert.equal(
    await page.locator(".semantic tr").filter({ hasText: /^Pin / }).count(),
    0,
  );
  await page.screenshot({ path: `${out}/hackrf-metadata.png` });
  await page.locator(".close-diff").click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#renames-toggle").click();
  const box = await page.locator("#renames").boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390);
  await page.screenshot({ path: `${out}/hackrf-phone-labels.png` });
  assert.deepEqual(errors, []);
  console.log("PASS: real HackRF label renames, counts, metadata inspector and phone bounds; no browser errors.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
