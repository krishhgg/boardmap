import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { reach } from "../src/compare.js";
import { changeGroup, changedPins } from "../web/review.js";
import { buildReport } from "../src/git.js";
import { serve } from "../src/server.js";
import { reviewFixture } from "./fixture.mjs";
const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    base: { type: "string" },
    head: { type: "string" },
    board: { type: "string" },
    out: { type: "string" },
    fixture: { type: "boolean" },
    removed: { type: "boolean" },
  },
});
const fixture = values.fixture
  ? reviewFixture({ removedOnly: values.removed })
  : null;
const report = buildReport(
  fixture?.repo ?? values.repo ?? ".",
  fixture?.base ?? values.base ?? "HEAD",
  fixture?.head ?? values.head ?? "HEAD",
  { board: values.board },
);
const server = await serve(report),
  browser = await chromium.launch({
    executablePath: process.env.BOARDMAP_BROWSER || undefined,
  });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const out = values.out;
if (out) await mkdir(out, { recursive: true });
const capture = async (name) => {
  if (out)
    await page.screenshot({
      path: `${out}/${name}.png`,
      fullPage: true,
      animations: "disabled",
    });
};
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator(".tile").first().waitFor();
  assert.equal(await page.locator(".tile").count(), report.parts.length);
  assert.equal(await page.locator(".part-row").count(), report.stats.changed);
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: ".tile .ref",
  });
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  assert.ok(
    fonts.some(
      (font) => font.familyName === "JetBrains Mono" && font.isCustomFont,
    ),
    "Chromium uses bundled JetBrains Mono for reference text",
  );
  assert.ok(
    !fonts.some((font) => /courier/i.test(font.familyName)),
    "no actual Courier fallback",
  );
  assert.equal(await page.locator(".list-heading.part-row").count(), 0);
  await page.locator(".tile .ref").evaluateAll((labels) => {
    for (const label of labels) {
      const tile = label.closest(".tile"),
        text = document.createRange();
      text.selectNodeContents(label);
      const rect = text.getBoundingClientRect(),
        box = tile.getBoundingClientRect();
      if (
        parseFloat(getComputedStyle(label).fontSize) < 9 ||
        rect.right > box.right - 3 ||
        rect.bottom > box.bottom - 3
      )
        throw new Error(`Unreadable reference ${label.textContent}`);
    }
  });
  const actualRows = await page
    .locator(".part-row")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: node.dataset.id,
        group: node.dataset.changeGroup,
      })),
    );
  assert.ok(
    actualRows.every(
      (row) =>
        row.group === changeGroup(report.parts.find((p) => p.id === row.id)),
    ),
    "sidebar classifies actual semantic changes",
  );
  const electrical = actualRows.filter((row) => row.group === "Electrical");
  const rewires = electrical.map(
    (row) => changedPins(report.parts.find((p) => p.id === row.id)).length,
  );
  assert.deepEqual(
    rewires,
    [...rewires].sort((a, b) => b - a),
    "rewired pin counts lead the electrical group",
  );
  await capture("map");
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.ok(await page.locator("#impact").isVisible());
  assert.ok(
    (await page.locator("#canvas").boundingBox()).height > 500,
    "map dominates 1280×800",
  );
  await capture("compact");
  await page.setViewportSize({ width: 1440, height: 900 });
  // Pick a large, connected part so screenshots and assertions cover real geometry.
  const candidate = (
    report.parts.some((p) => p.after)
      ? report.parts.filter((p) => p.after)
      : [...report.parts]
  ).sort((a, b) => Object.keys(b.pins).length - Object.keys(a.pins).length)[0];
  const tile = page
    .locator(".tile")
    .filter({
      has: page.locator("span.ref", {
        hasText: new RegExp(
          `^${candidate.ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        ),
      }),
    })
    .first();
  await tile.hover();
  assert.ok(
    (await page.locator("#connections path").count()) > 0,
    "hover draws net paths",
  );
  assert.ok(
    (await page.locator(".affected").count()) > 0,
    "neighbors highlighted",
  );
  const highlighted = await page
    .locator(".tile.affected")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.id).sort());
  assert.deepEqual(
    highlighted,
    reach(report, candidate.id).ids.sort(),
    "all direct neighbors stay highlighted, including dense fans",
  );
  const paths = await page.locator("#connections path").count();
  assert.match(
    await page.locator("#impact").innerText(),
    new RegExp(`${paths} curves shown`),
  );
  await capture("reach");
  await page.locator("#reach").selectOption("transitive");
  await tile.hover();
  assert.match(
    await page.locator("#impact").innerText(),
    /transitively reachable/,
  );
  await page.locator("#ground").check();
  await tile.hover();
  assert.match(await page.locator("#impact").innerText(), /Ground included/);
  await page.locator("#ground").uncheck();
  await page.locator("#reach").selectOption("direct");
  await tile.click();
  await page.locator("#diff-panel").waitFor({ state: "visible" });
  for (const [transitive, includeGround] of [
    [false, true],
    [true, true],
    [false, false],
  ]) {
    await page
      .locator("#reach")
      .selectOption(transitive ? "transitive" : "direct");
    await page.locator("#ground").setChecked(includeGround);
    const count = reach(report, candidate.id, {
      transitive,
      includeGround,
    }).ids.length;
    assert.match(
      await page.locator("#impact strong").innerText(),
      new RegExp(`${count} ${transitive ? "transitively reachable parts" : "connected parts"}`),
      "inspector reach readout follows both controls",
    );
  }
  assert.equal(await page.locator(".region svg").count(), 2);
  assert.ok((await page.locator(".semantic tr").count()) > 1);
  if (values.fixture) {
    assert.ok(
      (await page.locator("[data-drill]").count()) > 0,
      "drills render in local regions",
    );
    assert.ok(
      (await page.locator(".region svg").first().getAttribute("viewBox"))
        .split(" ")
        .map(Number)[2] > 42.5,
      "rotated pads fit region",
    );
  }
  if (values.fixture && !values.removed) {
    assert.equal(
      await page
        .locator(
          '.region [data-selected="true"][data-pad="1"][data-changed="false"]',
        )
        .count(),
      2,
      "unchanged pad 1 stays neutral in both revisions",
    );
    assert.equal(
      await page
        .locator(
          '.region [data-selected="true"][data-pad="2"][data-changed="true"]',
        )
        .count(),
      2,
      "changed pad 2 highlights in both revisions",
    );
    const row = page
      .locator(".semantic tr")
      .filter({ has: page.getByRole("cell", { name: "Value", exact: true }) });
    assert.deepEqual(await row.locator("td").allTextContents(), [
      "Value",
      "5V regulator",
      "3V3 regulator",
    ]);
    await page.locator(".geometry-details summary").click();
    const pad = page.locator(".semantic tr").filter({
      has: page.getByRole("cell", {
        name: "Pad 2 local geometry",
        exact: true,
      }),
    });
    const cells = await pad.locator("td").allTextContents();
    assert.match(cells[1], /drill \["0\.8"\]/);
    assert.match(cells[2], /drill \["1\.2"\]/);
    assert.equal(
      await page
        .getByRole("cell", { name: "Pad 1 local geometry", exact: true })
        .count(),
      0,
    );
  }
  await capture("diff");
  await page.keyboard.press("Escape");
  await page.locator("#map-panel").waitFor({ state: "visible" });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.ok(
    await page.evaluate(() =>
      document.activeElement.classList.contains("tile"),
    ),
    "closing diff restores map focus",
  );
  const focusedId = await page.evaluate(
    () => document.activeElement.dataset.id,
  );
  for (const height of [1100, 1000]) {
    await page.setViewportSize({ width: 1440, height });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.id),
      focusedId,
      "height-only resize retains map focus",
    );
  }
  if (report.parts.some((p) => p.status === "unchanged")) {
    // Exercise non-Mac text metrics and classic scrollbars during resize.
    const platformStyle = await page.addStyleTag({
      content:
        ':root { font-family: Arial, sans-serif; } ::-webkit-scrollbar { width: 15px; height: 15px; }',
    });
    for (const width of [1100, 390, 1440]) {
      const unchanged = page.locator(".tile.unchanged").first(),
        id = await unchanged.getAttribute("data-id");
      await unchanged.click();
      await page.setViewportSize({ width, height: 1000 });
      await page.keyboard.press("Escape");
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      assert.equal(
        await page.evaluate(() => document.activeElement.dataset.id),
        id,
        "exact unchanged tile retains focus after resize and Escape",
      );
    }
    await platformStyle.evaluate((node) => node.remove());
  }
  for (const status of ["modified", "added", "removed"]) {
    const row = page.locator(`.part-row.${status}`).first();
    if (await row.count()) {
      await row.click();
      assert.equal(
        await page.locator(".diff-header small").innerText(),
        status,
      );
      assert.ok((await page.locator(".semantic tr").count()) > 1);
      await page.keyboard.press("Escape");
    }
  }
  await page.locator(".group-title").first().press("Enter");
  assert.ok(
    await page.evaluate(() =>
      document.activeElement.classList.contains("tile"),
    ),
    "keyboard drill-in focuses the new map",
  );
  assert.ok((await page.locator(".tile").count()) <= report.parts.length);
  assert.match(await page.locator("#breadcrumbs").innerText(), /\//);
  const visibleIds = new Set(
    await page
      .locator(".tile")
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.id)),
  );
  assert.ok(
    (
      await page
        .locator(".part-row")
        .evaluateAll((nodes) => nodes.map((n) => n.dataset.id))
    ).every((id) => visibleIds.has(id)),
    "sidebar follows the current scope",
  );
  await capture("sheet");
  await page.locator("#breadcrumbs button").first().click();
  await page.locator("#search").fill(candidate.ref);
  assert.ok((await page.locator(".tile").count()) < report.parts.length);
  await page.locator("#search").fill("no-component-matches-this");
  await page.locator("#map-empty").waitFor({ state: "visible" });
  await page.locator("#search").fill("");
  await page.locator("#only-changed").uncheck();
  assert.equal(await page.locator(".part-row").count(), report.parts.length);
  await page.locator("#board-tab").click();
  if (report.boards.length > 1) {
    const choices = page.locator(".board-chooser button");
    assert.equal(await choices.count(), report.boards.length);
    for (const file of report.boards) {
      await page
        .getByRole("button", { name: file, exact: true })
        .press("Enter");
      assert.ok(
        await page.evaluate(() =>
          document.activeElement.classList.contains("tile"),
        ),
        "board choice preserves keyboard focus",
      );
      const ids = await page
        .locator(".tile")
        .evaluateAll((nodes) => nodes.map((n) => n.dataset.id).sort());
      assert.deepEqual(
        ids,
        report.parts
          .filter((p) => p.file === file)
          .map((p) => p.id)
          .sort(),
      );
      await page.locator("#breadcrumbs button").first().click();
    }
    await page
      .getByRole("button", { name: report.boards.at(-1), exact: true })
      .click();
  }
  await capture("board");
  await page.locator("#map-tab").click();
  for (const width of [720, 800, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `no horizontal overflow at ${width}px`,
    );
  }
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "no mobile horizontal overflow",
  );
  if (report.boards.length === 1) {
    await page.locator("#breadcrumbs button").first().click();
    for (const group of await page.locator(".group-title").all()) {
      const box = await group.boundingBox();
      assert.ok(
        box.width >= 60 && box.height >= 24,
        "small sheets retain visible drill targets",
      );
    }
  }
  await capture("mobile");
  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const touchPage = await touch.newPage();
  touchPage.on("pageerror", (e) => errors.push(e.message));
  await touchPage.goto(`http://127.0.0.1:${server.address().port}`);
  const touchTile = touchPage.locator(
    `.tile[data-id=${JSON.stringify(candidate.id)}]`,
  );
  const touchCapture = async (name) => {
    if (out)
      await touchPage.screenshot({
        path: `${out}/${name}.png`,
        animations: "disabled",
      });
  };
  await touchTile.waitFor();
  await touchCapture("touch-map");
  await touchTile.tap();
  assert.ok(
    await touchPage.locator("#map-panel").isVisible(),
    "first real touch tap previews reach",
  );
  assert.ok(
    await touchPage
      .getByRole("button", { name: `Open ${candidate.ref} diff`, exact: true })
      .isVisible(),
    "explicit touch inspect action",
  );
  assert.ok(
    (await touchPage.locator(".affected").count()) > 0,
    "touch highlights neighbors",
  );
  await touchCapture("touch-reach");
  await touchPage
    .getByRole("button", { name: `Open ${candidate.ref} diff`, exact: true })
    .tap();
  assert.ok(
    await touchPage.locator("#diff-panel").isVisible(),
    "explicit action opens diff",
  );
  await touchCapture("touch-diff");
  assert.ok(
    await touchPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "touch inspector has no horizontal overflow",
  );
  await touchPage.locator(".close-diff").tap();
  await touchTile.tap();
  await touchTile.tap();
  assert.ok(
    await touchPage.locator("#diff-panel").isVisible(),
    "second touch tap inspects",
  );
  await touchPage.locator(".close-diff").tap();
  await touchPage.locator("#toggle-changes").tap();
  assert.equal(
    await touchPage.locator("#toggle-changes").getAttribute("aria-expanded"),
    "true",
  );
  if (!report.stats.changed)
    await touchPage.locator("#only-changed").uncheck();
  await touchPage.locator(".part-row").first().tap();
  assert.ok(
    await touchPage.locator("#map-panel").isVisible(),
    "touch sidebar previews before inspection",
  );
  assert.ok(await touchPage.locator(".open-preview").isVisible());
  await touch.close();
  assert.deepEqual(errors, []);
  console.log(
    `PASS: ${report.parts.length} parts, ${report.stats.changed} changes; map, reach, transitive, ground, diff, drill-in, breadcrumbs, search, layout, mobile; no browser errors.`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  fixture?.cleanup();
}
