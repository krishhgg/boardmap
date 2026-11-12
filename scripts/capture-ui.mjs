// Captures the running UI on a pinned real comparison, for pull request and README media.
import { chromium } from "playwright";
import { mkdir, rename, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { buildReport } from "../src/git.js";
import { serve } from "../src/server.js";
const demos = {
  hackrf: {
    base: "f6598e7b14b7ec539126479e9c6d095c668a534e",
    head: "3bdc5547004c8244de5f37104410c363854e5634",
    part: "U17",
  },
  corne: {
    base: "a935f345c5e824aeaaa8f624ae2134fae47e128e",
    head: "eaf6e072fe273c2cfd64690de135ddb7ffe870f9",
    board: "pcbs/corne-cherry/hotswap/corne-cherry.kicad_pcb",
    part: "ZD1",
  },
};
const scenes = ["renames", "inspector", "map", "board", "phone", "motion"];
const [name, repo, out, ...wanted] = process.argv.slice(2),
  demo = demos[name];
if (!demo || !repo || !out || wanted.some((scene) => !scenes.includes(scene)))
  throw new Error(
    `Usage: node scripts/capture-ui.mjs <hackrf|corne> PATH_TO_GIT_CACHE OUT_DIR [${scenes.join("|")} ...]`,
  );
const run = (scene) => !wanted.length || wanted.includes(scene);
const report = buildReport(repo, demo.base, demo.head, { board: demo.board });
const server = await serve(report),
  url = `http://127.0.0.1:${server.address().port}`,
  browser = await chromium.launch({
    executablePath: process.env.BOARDMAP_BROWSER || undefined,
  });
await mkdir(out, { recursive: true });
const errors = [];
const subject = report.parts.find((p) => p.ref === demo.part);
const tileFor = (page, part) =>
  page.locator(`.tile[data-id=${JSON.stringify(part.id)}]`);
const sheetOf = (page, part) =>
  page
    .locator(".group")
    .filter({ has: tileFor(page, part) })
    .locator(".group-title");
async function desktop(options = {}) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    ...options,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator(".tile").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  return page;
}
async function phone() {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator(".tile").first().waitFor();
  return page;
}
const shot = (page, file) =>
  page.screenshot({ path: join(out, `${file}.png`), animations: "disabled" });
// Let hover and entry transitions finish before a still is taken.
const settle = (page) => page.waitForTimeout(350);
try {
  if (run("renames") && (report.sheetRenames?.length || report.netRenames?.length)) {
    const page = await desktop();
    await page.locator("#renames-toggle").click();
    await settle(page);
    await shot(page, "renames-desktop");
    await page.close();
    const touch = await phone();
    await touch.locator("#renames-toggle").tap();
    await settle(touch);
    await shot(touch, "renames-phone");
    await touch.context().close();
  }
  if (run("inspector")) {
    const page = await desktop();
    const open = async (part) => {
      await tileFor(page, part).click();
      await page.locator("#diff-panel").waitFor({ state: "visible" });
      await page.mouse.move(1430, 895);
      await settle(page);
    };
    await open(subject);
    await shot(page, "inspector-modified");
    await page.locator(".reach-details summary").click();
    await settle(page);
    await shot(page, "inspector-neighbors");
    await page.locator(".reach-details summary").click();
    if (await page.locator(".geometry-details > summary").count()) {
      await page.locator(".geometry-details > summary").click();
      await page.locator(".geometry-details").scrollIntoViewIfNeeded();
      await settle(page);
      await shot(page, "inspector-geometry");
    }
    await page.keyboard.press("Escape");
    for (const status of ["unchanged", "added", "removed"]) {
      const part = report.parts
        .filter((p) => p.status === status)
        .sort((a, b) => Object.keys(b.pins).length - Object.keys(a.pins).length)[0];
      if (!part) continue;
      await open(part);
      await shot(page, `inspector-${status}`);
      await page.keyboard.press("Escape");
    }
    await page.close();
  }
  if (run("map")) {
    const page = await desktop();
    await page.mouse.move(1430, 895);
    await shot(page, "map-idle");
    await tileFor(page, subject).hover();
    await settle(page);
    await shot(page, "map-reach");
    await page.mouse.move(1430, 895);
    await settle(page);
    await sheetOf(page, subject).click();
    await page.mouse.move(1430, 895);
    await settle(page);
    await shot(page, "sheet");
    await tileFor(page, subject).hover();
    await settle(page);
    await shot(page, "sheet-reach");
    await page.close();
  }
  if (run("board")) {
    const page = await desktop();
    await page.locator("#board-tab").click();
    await page.mouse.move(1430, 895);
    await settle(page);
    await shot(page, "board");
    await tileFor(page, subject).hover();
    await settle(page);
    await shot(page, "board-reach");
    await page.close();
    const touch = await phone();
    await touch.locator("#board-tab").tap();
    await settle(touch);
    await shot(touch, "board-phone");
    await touch.context().close();
  }
  if (run("phone")) {
    const page = await phone();
    await shot(page, "phone-idle");
    await tileFor(page, subject).tap();
    await settle(page);
    await shot(page, "phone-preview");
    await page.locator(".open-preview").tap();
    await settle(page);
    await shot(page, "phone-diff");
    await page.locator(".close-diff").tap();
    await page.locator("#toggle-changes").tap();
    await settle(page);
    await shot(page, "phone-changes");
    await page.context().close();
  }
  if (run("motion")) {
    // A real recording, so drill-in, drill-out and curve motion appear as they run.
    const size = { width: 1280, height: 800 };
    const page = await desktop({ viewport: size, recordVideo: { dir: out, size } });
    const pause = (ms) => page.waitForTimeout(ms);
    await page.mouse.move(640, 500);
    await pause(700);
    await tileFor(page, subject).hover();
    await pause(1500);
    await sheetOf(page, subject).hover();
    await pause(400);
    await sheetOf(page, subject).click();
    await pause(900);
    await tileFor(page, subject).hover();
    await pause(1500);
    await tileFor(page, subject).click();
    await pause(1600);
    await page.keyboard.press("Escape");
    await pause(900);
    await page.locator("#breadcrumbs button").first().click();
    await pause(1200);
    const video = page.video();
    await page.close();
    const webm = join(out, "motion.webm");
    await rename(await video.path(), webm);
    const gif = spawnSync(
      "ffmpeg",
      [
        "-y", "-i", webm, "-filter_complex",
        "fps=12,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
        "-loop", "0", join(out, "motion.gif"),
      ],
      { encoding: "utf8" },
    );
    if (gif.error || gif.status !== 0)
      console.warn("FFmpeg did not convert the recording. motion.webm is kept.");
    else await rm(webm);
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  console.log(`Captured ${name} into ${out}.`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
