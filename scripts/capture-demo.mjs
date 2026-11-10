import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { buildReport } from "../src/git.js";
import { serve } from "../src/server.js";
const repo = process.argv[2];
if (!repo)
  throw new Error(
    "Usage: node scripts/capture-demo.mjs PATH_TO_CORNE_GIT_CACHE [--gif]",
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
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const out = "docs/media/instrument/demo-frames";
await mkdir(out, { recursive: true });
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator(".tile").first().waitFor();
  const capture = async (name) => {
    return page.screenshot({
      path: `${out}/${name}.png`,
      animations: "disabled",
    });
  };
  await capture("01-map");
  await page.getByRole("button", { name: "Open left", exact: true }).click();
  await page.mouse.move(1, 1);
  await page.waitForFunction(() => !document.querySelector(".tile.hovered"));
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
  if (process.argv.includes("--gif")) {
    const frames = ["01-map", "02-sheet", "03-reach", "04-diff"];
    const durations = [1.2, 1.2, 2.8, 2.8];
    const manifest = resolve(out, "frames.txt");
    await writeFile(
      manifest,
      frames
        .map((frame, i) => `file '${frame}.png'\nduration ${durations[i]}`)
        .join("\n") + `\nfile '${frames.at(-1)}.png'\n`,
    );
    try {
      const result = spawnSync(
        "ffmpeg",
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          manifest,
          "-filter_complex",
          "fps=10,scale=1100:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3",
          "-t",
          "8",
          "-loop",
          "0",
          "docs/media/instrument/boardmap-demo.gif",
        ],
        { encoding: "utf8" },
      );
      if (result.error || result.status !== 0)
        throw new Error(result.error?.message ?? result.stderr);
    } finally {
      await unlink(manifest);
    }
  }
  console.log(
    "Captured real Corne ZD1 review frames. Pin 2 changes from GND to VBUS.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
