import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { buildReport } from "../src/git.js";
import { serve } from "../src/server.js";
const repo = process.argv[2];
if (!repo)
  throw new Error(
    "Usage: node scripts/capture-demo.mjs PATH_TO_CORNE_GIT_CACHE",
  );
const report = buildReport(
  repo,
  "a935f345c5e824aeaaa8f624ae2134fae47e128e",
  "eaf6e072fe273c2cfd64690de135ddb7ffe870f9",
  { board: "pcbs/corne-cherry/hotswap/corne-cherry.kicad_pcb" },
);
const server = await serve(report),
  browser = await chromium.launch({
    executablePath: process.env.BOARDMAP_BROWSER || undefined,
  });
const page = await browser.newPage({
  viewport: { width: 1000, height: 1100 },
  deviceScaleFactor: 1,
});
const out = "docs/media/demo-frames";
await mkdir(out, { recursive: true });
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator(".tile").first().waitFor();
  const capture = async (name) => {
    const box = await page.locator(".workspace").boundingBox();
    return page.screenshot({
      path: `${out}/${name}.png`,
      clip: { x: 0, y: box.y, width: 1000, height: 850 },
      animations: "disabled",
    });
  };
  await capture("01-map");
  await page.getByRole("button", { name: "Open left", exact: true }).click();
  await page.locator("#impact").hover();
  await capture("02-sheet");
  const target = page
    .locator(".tile")
    .filter({ has: page.locator(".ref", { hasText: /^ZD1$/ }) });
  await target.hover();
  await capture("03-reach");
  await target.click();
  await page.locator("#diff-panel").waitFor({ state: "visible" });
  assert.deepEqual(
    await page
      .locator(".semantic tr")
      .filter({ hasText: /^Pin 2/ })
      .locator("td")
      .allTextContents(),
    ["Pin 2", "GND", "VBUS"],
  );
  await capture("04-diff");
  console.log(
    "Captured real Corne ZD1 review frames. Pin 2 changes from GND to VBUS.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
