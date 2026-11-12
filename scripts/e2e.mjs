import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { reach } from "../src/compare.js";
import { changeGroup, changedPins, changedLinks, footprintExtent, isElectrical, netReachGroups } from "../web/review.js";
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
    navigation: { type: "boolean" },
    detail: { type: "boolean" },
    continuity: { type: "boolean" },
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
// Layout checks measure tiles at rest, so these contexts ask for reduced motion.
// The motion check near the end runs with animation enabled.
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const out = values.out;
if (out) await mkdir(out, { recursive: true });
const selectedCaptures = new Set(
  report.parts.some((p) => p.ref === "U17")
    ? ["map", "header-1024", "keyboard-focus", "u17-inspector"]
    : ["touch-reach", "touch-diff"],
);
const detailCaptures = new Set([
  "map", "reach", "reached-parts", "laptop-inspector",
  "classification", "touch-sheet", "touch-sheet-preview",
  "readout-1280", "readout-1024",
  "board-neighbor-return",
]);
const continuityCaptures = new Set([
  "returned-part", "escape-return", "board-neighbor-return", "board-list-return", "touch-board-list-return", "tablet-return", "readable-sheet", "readable-root", "touch-return", "touch-root",
]);
const shouldCapture = (name) =>
  out && (values.continuity
    ? continuityCaptures.has(name)
    : values.detail
    ? detailCaptures.has(name)
    : !values.navigation || selectedCaptures.has(name));
const capture = async (name) => {
  if (shouldCapture(name))
    await page.screenshot({
      path: `${out}/${name}.png`,
      fullPage: true,
      animations: "disabled",
    });
};
const previewSettled = (id) => page.waitForFunction((expected) => {
  const tile = document.querySelector(".tile.hovered");
  return expected ? tile?.dataset.id === expected : !tile;
}, id);
const hoverPart = async (node) => {
  await node.hover({ position: { x: 1, y: 1 } });
  await node.hover();
  await previewSettled(await node.getAttribute("data-id"));
};
// On phones the breadcrumb is drawn only below the top level.
const goHome = async (surface) => {
  const home = surface.locator("#breadcrumbs button").first();
  if (await home.isVisible()) await home.click();
};
// A leading net and its part count share one line, and the tooltip keeps the whole name.
const assertLeadingNetsOnOneLine = async (surface) => {
  const rows = await surface.locator("#impact > div > .net-reach-list li").evaluateAll((items) =>
    items.map((item) => ({
      net: item.dataset.net,
      height: item.getBoundingClientRect().height,
      title: item.querySelector("span").title,
    })));
  assert.ok(rows.every((row) => row.height <= 20 && row.title === row.net),
    `leading nets stay on one line with their full name in the tooltip: ${JSON.stringify(rows)}`);
};
const assertReadoutFits = async (surface) => {
  const clipped = await surface.locator("#impact").evaluate((box) => {
    const bounds = box.getBoundingClientRect();
    return [...box.querySelectorAll(":scope > div > strong, :scope > div > p, :scope > div > .net-reach-list, .open-preview")]
      .map((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const text = range.getBoundingClientRect();
        return { text: node.textContent, bottom: text.bottom, right: text.right };
      })
      .filter((node) => node.bottom > bounds.bottom - 4 || node.right > bounds.right - 4);
  });
  assert.deepEqual(clipped, [], "readout heading, leading nets, qualifiers and action fit in full");
};
const assertReturnedPart = async (surface, id) => {
  assert.equal(await surface.locator(".tile.hovered").getAttribute("data-id"), id,
    "Back visibly identifies the returned component for every input method");
  const part = report.parts.find((p) => p.id === id);
  assert.ok((await surface.locator("#impact strong").first().innerText()).startsWith(`${part.ref} ·`),
    "the returned component is named in the reach readout");
};
const assertSheetReferences = async (surface) => {
  const failures = await surface.locator(".tile").evaluateAll((nodes) => {
    const bad = [];
    for (const tile of nodes) {
      const ref = tile.title.split(" · ")[0];
      if (!ref.trim()) continue;
      const label = tile.querySelector(".ref");
      if (!label) { bad.push(`${ref}: missing`); continue; }
      const range = document.createRange();
      range.selectNodeContents(label);
      const text = range.getBoundingClientRect(), box = tile.getBoundingClientRect();
      if (parseFloat(getComputedStyle(label).fontSize) < 9 ||
          text.right > box.right - 3 || text.bottom > box.bottom - 3)
        bad.push(`${ref}: clipped`);
    }
    return bad;
  });
  assert.deepEqual(failures, [], "every drilled reference is whole and readable");
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
  const renamedLabels = [
    ...(report.sheetRenames ?? []).map((r) => `Sheet: ${r.before} → ${r.after}`),
    ...(report.netRenames ?? []).map((r) => `Net: ${r.before} → ${r.after}`),
  ];
  const renameRows = (surface) =>
    surface.locator("#renames li").evaluateAll((rows) =>
      rows.map((row) =>
        `${row.dataset.kind}: ${row.querySelector(".before").textContent} → ${row.querySelector(".after").textContent}`,
      ),
    );
  if (renamedLabels.length) {
    const toggle = page.locator("#renames-toggle"),
      panel = page.locator("#renames");
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    await toggle.click();
    assert.deepEqual(await renameRows(page), renamedLabels,
      "the disclosure names every proved sheet and net label rename");
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    const header = await page.locator("header").boundingBox(),
      opened = await panel.boundingBox();
    assert.ok(opened.y >= header.y + header.height,
      "the rename panel opens below the header and leaves the revision readable");
    await page.keyboard.press("Escape");
    // The panel fades out, so each dismissal waits for the hidden state.
    await panel.waitFor({ state: "hidden" });
    assert.ok(await toggle.evaluate((node) => node === document.activeElement),
      "Escape leaves focus on the rename control");
    await toggle.click();
    await page.locator("footer").click();
    await panel.waitFor({ state: "hidden" });
    await toggle.click();
    await panel.locator(".renames-close").click();
    await panel.waitFor({ state: "hidden" });
    await page.locator(".tile").first().click();
    await toggle.click();
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    assert.ok(await page.locator("#diff-panel").isVisible(),
      "Escape closes only the rename panel, not the inspection beneath it");
    // Start the remaining checks from a fresh page, without a returned-part mark.
    await page.reload();
    await page.locator(".tile").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
  }
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
  const actualRows = await page.locator(".part-row").evaluateAll((nodes) =>
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
  const legend = await page.locator(".legend [data-count]").evaluateAll((nodes) =>
    Object.fromEntries(nodes.map((node) => [node.dataset.count, Number(node.textContent)])),
  );
  const expectedLegend = { electrical: 0, metadata: 0, added: 0, removed: 0, unchanged: 0 };
  for (const p of report.parts) expectedLegend[changeGroup(p).toLowerCase()]++;
  assert.deepEqual(legend, expectedLegend, "the legend counts every tile class in view");
  for (const title of await page.locator(".group-title").all()) {
    const ids = await title.locator("xpath=..").locator(".tile").evaluateAll((nodes) =>
      nodes.map((node) => node.dataset.id));
    const expected = {};
    for (const id of ids) {
      const kind = changeGroup(report.parts.find((p) => p.id === id)).toLowerCase();
      if (["electrical", "added", "removed"].includes(kind)) expected[kind] = (expected[kind] ?? 0) + 1;
    }
    const shown = await title.locator(".group-changes span").evaluateAll((nodes) =>
      Object.fromEntries(nodes.map((node) => [node.dataset.kind, Number(node.textContent)])));
    assert.deepEqual(shown, expected,
      "each sheet header counts electrical edits, added and removed parts as the legend does");
  }
  assert.ok(await page.locator(".group-title > span:first-child").evaluateAll((names) =>
    names.every((name) => name.clientWidth >= Math.min(name.scrollWidth, 56))),
    "a sheet header always leaves room to read its name");
  const split = await page.locator("#stats .split span").evaluateAll((nodes) =>
    nodes.map((node) => parseInt(node.textContent, 10)));
  assert.deepEqual(split, [expectedLegend.electrical, expectedLegend.added, expectedLegend.removed],
    "the header splits its electrical total into the legend's three classes");
  assert.equal(split.reduce((sum, count) => sum + count, 0),
    Number(await page.locator("#stats .electrical strong").innerText()),
    "the header's electrical total is the sum of those classes");
  assert.equal(await page.locator(".reach-key li").count(), 5,
    "the idle readout explains the trace marks");
  const leading = report.parts.filter(isElectrical);
  assert.equal(await page.locator(".start-part").count(), Math.min(3, leading.length));
  if (leading.length) {
    const first = page.locator(".start-part").first(),
      firstId = await first.getAttribute("data-id");
    assert.equal(firstId, await page.locator(".part-row").first().getAttribute("data-id"),
      "the idle readout starts with the same part as the review list");
    await first.focus();
    await page.keyboard.press("Escape");
    assert.ok(await first.evaluate((node) => node === document.activeElement),
      "an idle readout keeps its focused control when nothing changed");
    await first.click();
    assert.equal(await page.locator("#diff-panel").getAttribute("data-id"), firstId);
    await page.keyboard.press("Escape");
    await assertReturnedPart(page, firstId);
    await page.locator("#search").focus();
    await page.mouse.move(1, 1);
    await previewSettled(null);
  }
  const electricalTotal = report.parts.filter(isElectrical).length;
  const edits = report.parts.filter(
    (p) => changeGroup(p) === "Electrical",
  ).length;
  if (edits)
    assert.equal(
      await page
        .locator(".list-heading")
        .filter({ hasText: "Electrical edits" })
        .locator(".group-count")
        .innerText(),
      String(edits),
      "sidebar Electrical edits counts modifications, while the header also includes additions and removals",
    );
  for (const width of [1024, 720]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.locator("#stats .electrical").isVisible(),
      `Electrical remains visible at ${width}px`,
    );
    assert.equal(
      await page.locator("#stats .electrical strong").innerText(),
      String(electricalTotal),
    );
    assert.equal(await page.locator("#stats .nets").isVisible(), false);
    assert.equal(
      await page
        .locator("#stats .electrical strong")
        .evaluate((node) => getComputedStyle(node).color),
      "rgb(255, 138, 61)",
    );
    if (width === 1024) await capture("header-1024");
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const tabStops = async (selector) =>
    page
      .locator(`${selector} button`)
      .evaluateAll(
        (buttons) => buttons.filter((button) => button.tabIndex === 0).length,
      );
  assert.equal(await tabStops("#tiles"), 1);
  assert.equal(await tabStops("#part-list"), report.stats.changed ? 1 : 0);
  if (report.stats.changed) {
    await page.locator("#search").focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .locator("#only-changed")
        .evaluate((n) => n === document.activeElement),
      true,
    );
    await page.keyboard.press("Tab");
    assert.ok(
      await page.evaluate(() => document.activeElement.matches(".part-row")),
    );
    for (const [key, index] of [
      ["End", -1],
      ["Home", 0],
      ["ArrowDown", 1],
      ["ArrowUp", 0],
    ]) {
      await page.keyboard.press(key);
      assert.equal(
        await page
          .locator(".part-row")
          .evaluateAll(
            (nodes, index) =>
              document.activeElement ===
              nodes.at(Math.min(index, nodes.length - 1)),
            index,
          ),
        true,
      );
      assert.equal(await tabStops("#part-list"), 1);
    }
    if ((await page.locator(".part-row").count()) > 30) {
      await page.keyboard.press("End");
      for (let step = 0; step < 24; step++) await page.keyboard.press("ArrowUp");
      const covered = await page.evaluate(() => {
        const row = document.activeElement.getBoundingClientRect();
        return [...document.querySelectorAll(".list-heading")].some((heading) => {
          const box = heading.getBoundingClientRect();
          return box.bottom > row.top + 1 && box.top < row.bottom - 1;
        });
      });
      assert.ok(!covered, "a pinned group heading never covers the focused row");
      await page.keyboard.press("Home");
    }
    const origin = await page.evaluate(() => document.activeElement.dataset.id);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.id),
      origin,
    );
    assert.ok(
      await page.evaluate(() => document.activeElement.matches(".part-row")),
      "Escape returns to the exact originating list row",
    );
    await page.keyboard.press("Tab");
    assert.ok(
      await page.evaluate(() => document.activeElement.matches("#breadcrumbs button")),
      "one Tab exits the entire list to the map's first control",
    );
  }
  await page.locator('#tiles button[tabindex="0"]').focus();
  for (const [key, index] of [
    ["End", -1],
    ["Home", 0],
    ["ArrowRight", 1],
    ["ArrowLeft", 0],
    ["ArrowDown", 1],
    ["ArrowUp", 0],
  ]) {
    await page.keyboard.press(key);
    assert.equal(
      await page
        .locator("#tiles button")
        .evaluateAll(
          (nodes, index) =>
            document.activeElement ===
            nodes.at(Math.min(index, nodes.length - 1)),
          index,
        ),
      true,
    );
    assert.equal(await tabStops("#tiles"), 1);
  }
  await page.keyboard.press("ArrowRight");
  await capture("keyboard-focus");
  const mapOrigin = await page.evaluate(
    () => document.activeElement.dataset.focusKey,
  );
  await page.keyboard.press("Space");
  assert.ok(
    await page.locator("#diff-panel").isVisible(),
    "native Space inspects a map tile",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.focusKey),
    mapOrigin,
  );
  await page.keyboard.press("End");
  await page.keyboard.press("Tab");
  assert.ok(
    await page.evaluate(() => !document.activeElement.closest("#tiles")),
    "Tab exits the map group",
  );
  await page.keyboard.press("Escape");
  // Faint labels must remain legible on every background that uses them.
  assert.ok(
    await page.evaluate(() => {
      const luminance = (rgb) => {
        const channels = rgb
          .map((v) => v / 255)
          .map((v) =>
            v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
          );
        return (
          channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
        );
      };
      const style = getComputedStyle(document.documentElement);
      const color = (name) =>
        style
          .getPropertyValue(name)
          .trim()
          .slice(1)
          .match(/../g)
          .map((v) => parseInt(v, 16));
      return ["--bg", "--panel", "--raised", "--tile"].every(
        (name) =>
          (luminance(color("--faint")) + 0.05) /
            (luminance(color(name)) + 0.05) >=
          4.5,
      );
    }),
    "faint text meets 4.5:1 contrast",
  );
  for (const p of report.parts.filter((p) => changeGroup(p) === "Metadata")) {
    const node = page.locator(`.tile[data-id=${JSON.stringify(p.id)}]`);
    assert.equal(
      await node.evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgb(29, 37, 44)",
      "metadata retains a neutral fill, including added and removed artwork",
    );
    if (p.status === "removed")
      assert.equal(
        await node.evaluate((n) => getComputedStyle(n).borderTopStyle),
        "dashed",
      );
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  assert.ok(await page.locator("#impact").isVisible());
  assert.ok(
    (await page.locator("#canvas").boundingBox()).height > 440,
    "map dominates 1280×800",
  );
  await capture("compact");
  if (report.head === "eaf6e072fe273c2cfd64690de135ddb7ffe870f9" &&
      report.boards.length === 1 &&
      report.boards[0] === "pcbs/corne-cherry/hotswap/corne-cherry.kicad_pcb") {
    for (const [width, height, refs] of [[1280, 800, ["R8", "R9"]], [1024, 720, ["J2"]]]) {
      await page.setViewportSize({ width, height });
      for (const ref of refs) {
        const part = report.parts.find((p) => p.ref === ref);
        const label = page.locator(`.tile[data-id=${JSON.stringify(part.id)}] .ref`);
        assert.equal(await label.innerText(), ref, `${ref} remains named at ${width}px`);
      }
    }
  }
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
  await hoverPart(tile);
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
  const netCounts = await page.locator(".net-reach-list li").evaluateAll((nodes) =>
    nodes.map((node) => ({ name: node.dataset.net, count: Number(node.dataset.count) })),
  );
  assert.deepEqual(netCounts.map((net) => net.name).sort(), reach(report, candidate.id).nets.sort(),
    "the readout lists every included net across both revisions");
  const netTiers = await page.locator(".net-reach-list li").evaluateAll((nodes) =>
    nodes.map((node) => ({
      rank: Number(node.dataset.rank),
      rail: Number(node.dataset.count) > 12,
      changed: Boolean(node.dataset.change) && Number(node.dataset.count) > 0,
      count: Number(node.dataset.count),
    })),
  );
  assert.deepEqual(netTiers.map((net) => net.rank),
    netTiers.map((net) => (net.changed ? (net.rail ? 1 : 0) : 2)),
    "joined or left signal nets rank first, then joined or left rails, then the rest");
  assert.deepEqual(netTiers.map((net) => net.rank),
    [...netTiers.map((net) => net.rank)].sort((a, b) => a - b),
    "the readout lists nets in rank order");
  for (const rank of [0, 1, 2]) {
    const counts = netTiers.filter((net) => net.rank === rank).map((net) => net.count);
    assert.deepEqual(counts, [...counts].sort((a, b) => b - a),
      "larger net reach appears first within each tier");
  }
  const expectedLinks = changedLinks(report, candidate.id);
  // On a busy trace, a rail with more than 12 loads is shown without curves.
  const direct = reach(report, candidate.id),
    lightest = new Map();
  const reachNets = netReachGroups(report, candidate, direct);
  for (const net of reachNets)
    for (const id of net.ids)
      lightest.set(id, Math.min(lightest.get(id) ?? Infinity, net.ids.length));
  // A rail is any net with more than 12 loads, whether or not it hides a curve.
  const railed = direct.ids.length > 30 && reachNets.some((net) => net.ids.length > 12);
  const drawn = (id) => !railed || lightest.get(id) <= 12;
  for (const kind of ["gained", "lost"]) {
    assert.deepEqual(
      await page.locator(`.tile.${kind}`).evaluateAll((nodes) => nodes.map((node) => node.dataset.id).sort()),
      expectedLinks[kind].sort(),
      `parts connected only in ${kind === "gained" ? "head" : "base"} are marked`);
    assert.equal(await page.locator(`#connections path.${kind}`).count(),
      expectedLinks[kind].filter(drawn).length,
      "every changed connection off the rails has its own curve");
  }
  // On a hub with changed links, only those links are drawn and unchanged neighbors lose their ring.
  const hubTrace = direct.ids.length > 60 &&
    [...expectedLinks.gained, ...expectedLinks.lost].some(drawn);
  if (hubTrace) {
    assert.equal(await page.locator("#connections path:not(.gained):not(.lost)").count(), 0,
      "a hub trace draws curves for changed connections only");
    assert.match(await page.locator("#impact p").innerText(), /changed links only/);
    assert.ok(await page.locator(".tile.affected:not(.gained):not(.lost)").evaluateAll((tiles) =>
      tiles.every((tile) => getComputedStyle(tile).boxShadow === "none")),
      "an unchanged connection on a hub trace has no ring");
  }
  // A neighbor reached only through a rail is tinted without a ring.
  assert.deepEqual(
    await page.locator(".tile.railed").evaluateAll((nodes) => nodes.map((node) => node.dataset.id).sort()),
    railed ? direct.ids.filter((id) => !drawn(id)).sort() : [],
    "rail-only neighbors, and only those, give up their ring");
  if (await page.locator("#connections path").count() <= 40)
    assert.equal(await page.locator("#connections .link-start").count(),
      await page.locator("#connections path").count(),
      "each curve has a dot where it leaves the traced part");
  assert.equal(await page.locator(".net-reach-list li.rail").count() > 0, railed,
    "rails shown without curves are marked in the net list");
  if (railed)
    assert.match(await page.locator("#impact p").innerText(), /no curves for /,
      "the readout says which rails are shown without curves");
  const leadingNet = await page.locator(".net-reach-list li").first().boundingBox();
  const readout = await page.locator("#impact").boundingBox();
  assert.ok(leadingNet.y >= readout.y && leadingNet.y + leadingNet.height <= readout.y + readout.height,
    "the leading net count is visible without scrolling the readout");
  assert.ok(await page.evaluate(() => {
    const canvas = document.getElementById("canvas").getBoundingClientRect();
    const tiles = [...document.querySelectorAll(".tile:is(.hovered, .affected)")]
      .map((tile) => tile.getBoundingClientRect());
    return [...document.querySelectorAll("#label-mask rect[rx]")].every((rect) => {
      const x = rect.x.baseVal.value + canvas.x, y = rect.y.baseVal.value + canvas.y;
      return tiles.some((tile) => x >= tile.left - 4 && x + rect.width.baseVal.value <= tile.right + 4 &&
        y >= tile.top - 2 && y + rect.height.baseVal.value <= tile.bottom + 2);
    });
  }), "curves are hidden only behind the visible part of a name");
  const paths = await page.locator("#connections path").count();
  assert.match(
    await page.locator("#impact").innerText(),
    new RegExp(`${paths} ${paths === 1 ? "curve" : "curves"} shown`),
  );
  // Move into the real gutter outside this tile, while staying inside the canvas.
  await page.locator("#search").focus();
  await hoverPart(tile);
  await page.locator("#impact").hover();
  // Let the intentional pointer-exit grace period elapse while reading the net list.
  await page.waitForTimeout(160);
  await page.locator(".net-reach-list li").last().scrollIntoViewIfNeeded();
  assert.equal(await page.locator(".tile.hovered").getAttribute("data-id"), candidate.id,
    "scrolling the full net breakdown preserves the graph preview");
  await page.locator(".net-reach-more .net-reach-list").evaluateAll((nodes) => {
    for (const node of nodes) node.scrollTop = 0;
  });
  const crossed = report.parts.find((p) => p.id !== candidate.id);
  await page.locator(`.tile[data-id=${JSON.stringify(crossed.id)}]`).hover();
  await page.locator("#impact").hover();
  await page.waitForTimeout(180);
  assert.equal(await page.locator(".tile.hovered").getAttribute("data-id"), candidate.id,
    "crossing another tile briefly on the way to the readout preserves the source");
  await hoverPart(tile);
  const box = await tile.boundingBox();
  await page.mouse.move(box.x - 1, box.y + box.height / 2);
  assert.equal(
    await page.locator(".tile.hovered").getAttribute("data-id"),
    candidate.id,
    "crossing a tile gutter keeps the current preview",
  );
  await page.mouse.move(1, 1);
  await previewSettled(null);
  assert.equal(
    await page.locator(".tile.hovered").count(),
    0,
    "leaving the canvas clears pointer preview",
  );
  await tile.focus();
  const otherId = report.parts.find((p) => p.id !== candidate.id).id;
  const otherTile = page.locator(`.tile[data-id=${JSON.stringify(otherId)}]`);
  await hoverPart(otherTile);
  await page.mouse.move(1, 1);
  await previewSettled(candidate.id);
  assert.equal(
    await page.locator(".tile.hovered").getAttribute("data-id"),
    candidate.id,
    "leaving pointer preview restores the keyboard-focused component",
  );
  const firstRow = page.locator(".part-row").first();
  if (await firstRow.count()) {
    await firstRow.focus();
    await hoverPart(otherTile);
    await page.mouse.move(1, 1);
    await previewSettled(await firstRow.getAttribute("data-id"));
    assert.equal(
      await page.locator(".tile.hovered").getAttribute("data-id"),
      await firstRow.getAttribute("data-id"),
      "leaving the map restores a keyboard-focused sidebar component",
    );
    await tile.focus();
    await hoverPart(firstRow);
    await page.mouse.move(1, 1);
    await previewSettled(candidate.id);
    assert.equal(
      await page.locator(".tile.hovered").getAttribute("data-id"),
      candidate.id,
      "leaving the sidebar restores a keyboard-focused map component",
    );
  }
  await page.locator("#search").focus();
  assert.equal(
    await page.locator(".tile.hovered").count(),
    0,
    "blur clears keyboard preview",
  );
  await hoverPart(tile);
  if (candidate.status === "modified")
    assert.ok((await page.locator("#impact .readout-change").innerText()).length > 3,
      "the readout names what changed on the traced part");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 720 }, { width: 720, height: 900 }]) {
    await page.setViewportSize(viewport);
    await hoverPart(page.locator(`.tile[data-id=${JSON.stringify(candidate.id)}]`));
    await assertReadoutFits(page);
    await assertLeadingNetsOnOneLine(page);
    if (viewport.width === 1024 &&
        report.head === "3bdc5547004c8244de5f37104410c363854e5634" &&
        report.boards.includes("hardware/hackrf-one/hackrf-one.kicad_pcb")) {
      const source = await tile.boundingBox();
      const destination = await page.locator(".net-reach-more .net-reach-list").boundingBox();
      const start = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
      const end = { x: destination.x + destination.width / 2, y: destination.y + destination.height / 2 };
      await page.mouse.move(start.x, start.y);
      const began = Date.now();
      for (let step = 1; step <= 30; step++) {
        const t = step / 30, eased = (1 - Math.cos(Math.PI * t)) / 2;
        await page.mouse.move(start.x + (end.x - start.x) * eased,
          start.y + (end.y - start.y) * eased);
        await page.waitForTimeout(Math.max(0, began + 1300 * t - Date.now()));
      }
      assert.equal(await page.locator(".tile.hovered").getAttribute("data-id"), candidate.id,
        "a slow accelerated pointer path to the net list preserves the source");
      const canvas = await page.locator("#canvas").boundingBox();
      await page.mouse.move(end.x, canvas.y - 6);
      await page.waitForTimeout(200);
      assert.equal(await page.locator(".tile.hovered").getAttribute("data-id"), candidate.id,
        "the gap between the map and readout belongs to the same hover area");
      const other = report.parts.find((p) => p.ref === "U24");
      await page.locator(`.tile[data-id=${JSON.stringify(other.id)}]`).hover();
      await page.waitForTimeout(220);
      assert.equal(await page.locator(".tile.hovered").getAttribute("data-id"), other.id,
        "resting on a different component still retargets");
      await hoverPart(tile);
    }
    if ([1280, 1024].includes(viewport.width)) await capture(`readout-${viewport.width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await hoverPart(tile);
  await capture("reach");
  await page.locator("#reach").selectOption("transitive");
  await page.mouse.move(1, 1);
  await previewSettled(null);
  assert.match(await page.locator(".reach-key").innerText(), /Other structural reach/,
    "the transitive key does not call mixed-revision reach connected in both");
  assert.match(await page.locator("#impact p").innerText(), /not signal propagation/,
    "the idle readout states the transitive caveat");
  const idleHeight = (await page.locator("#impact").boundingBox()).height;
  await hoverPart(tile);
  assert.match(
    await page.locator("#impact").innerText(),
    /transitively reachable/,
  );
  assert.equal((await page.locator("#impact").boundingBox()).height, idleHeight,
    "a transitive trace keeps the readout's idle height, so the map does not move");
  assert.ok(!(await page.locator("#tiles").evaluate((node) => node.classList.contains("hub"))),
    "a transitive trace is never simplified as a hub");
  const farLinks = changedLinks(report, candidate.id, { transitive: true }),
    nearIds = new Set(reach(report, candidate.id).ids);
  assert.ok(
    (await page.locator("#connections path:is(.gained, .lost)").count()) <=
      [...farLinks.gained, ...farLinks.lost].filter((id) => nearIds.has(id)).length,
    "in a transitive trace only curves from the traced part carry revision color");
  await page.locator("#ground").check();
  await hoverPart(tile);
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
      await page.locator(".reach-details > summary").innerText(),
      new RegExp(
        `${count} ${transitive ? "transitively reachable" : "shared-net"} neighbor`,
      ),
      "inspector reach readout follows both controls",
    );
  }
  assert.equal(await page.locator(".region svg").count(), 2);
  await page.locator(".reach-details > summary").click();
  await page.locator(".reach-part").first().waitFor();
  const reachedIds = await page.locator(".reach-part").evaluateAll((nodes) =>
    [...new Set(nodes.map((node) => node.dataset.id))].sort(),
  );
  assert.deepEqual(reachedIds, reach(report, candidate.id).ids.sort(),
    "the inspector names every reached part, including loads outside the current view");
  assert.equal(await page.locator('.reach-part[tabindex="0"]').count(), 1);
  const reachList = await page.locator(".reach-parts").evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    overflow: getComputedStyle(node).overflowY,
  }));
  assert.ok(reachList.height <= 420 && reachList.overflow === "auto",
    "a long neighbor list scrolls inside its disclosure instead of pushing the pin table away");
  await capture("reached-parts");
  const reached = page.locator(".reach-part").first();
  const reachedId = await reached.getAttribute("data-id");
  await reached.press("Enter");
  assert.equal(await page.locator("#diff-panel").getAttribute("data-id"), reachedId);
  await page.locator(".close-diff").click();
  await assertReturnedPart(page, reachedId);
  await capture("returned-part");
  const parkedPart = report.parts
    .filter((p) => p.id !== reachedId)
    .sort((a, b) => Object.keys(b.pins).length - Object.keys(a.pins).length)[0];
  const parkedBox = await page.locator(`.tile[data-id=${JSON.stringify(parkedPart.id)}]`).boundingBox();
  await tile.click();
  await page.locator(".reach-details > summary").click();
  await page.locator(`.reach-part[data-id=${JSON.stringify(reachedId)}]`).first().click();
  await page.mouse.move(parkedBox.x + parkedBox.width / 2, parkedBox.y + parkedBox.height / 2);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await assertReturnedPart(page, reachedId);
  await capture("escape-return");
  await tile.click();
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
          '.region [data-selected="true"][data-pad=""][data-changed="true"]',
        )
        .count(),
      2,
      "changed mounting hole highlights in both revisions",
    );
    assert.equal(
      await page
        .locator(
          '.region [data-selected="true"][data-pad=""][data-changed="false"]',
        )
        .count(),
      2,
      "the other mounting hole stays unchanged in both revisions",
    );
    for (const width of [720, 390]) {
      await page.setViewportSize({ width, height: 844 });
      // The pinned table header follows the part header's height after a resize.
      await page.waitForFunction(() => {
        const panel = document.getElementById("diff-panel");
        return panel.style.getPropertyValue("--diff-head") ===
          `${panel.querySelector(".diff-header").offsetHeight}px`;
      });
      const property = page.getByRole("cell", {
        name: "Property: ManufacturerPartNumber",
        exact: true,
      });
      assert.ok(
        await property.evaluate((cell) => cell.scrollWidth <= cell.clientWidth),
        "long property keys wrap within their column",
      );
    }
    await page.setViewportSize({ width: 1440, height: 900 });
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
    await page.locator(".geometry-details > summary").click();
    const pad = page.locator(".semantic tr").filter({
      has: page.getByRole("cell", {
        name: "Pad 2",
        exact: true,
      }),
    });
    const changedFacts = (side) =>
      pad.locator(`td:nth-child(${side}) dd.changed`).allTextContents();
    assert.deepEqual(await changedFacts(2), ["0.8 mm"],
      "only the drill that changed is emphasized in base");
    assert.deepEqual(await changedFacts(3), ["1.2 mm"],
      "only the drill that changed is emphasized in head");
    assert.match(await pad.locator("td").nth(1).innerText(), /Size\s+2 × 2 mm/,
      "pad geometry reads as named properties with units");
    assert.equal(
      await page.getByRole("cell", { name: "Pad 1", exact: true }).count(),
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
        ":root { font-family: Arial, sans-serif; } ::-webkit-scrollbar { width: 15px; height: 15px; }",
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
  const swap =
    report.parts.find(
      (p) => p.ref === "U17" && p.changes.some((c) => c.field === "value"),
    ) ??
    (values.fixture && !values.removed
      ? report.parts.find((p) => p.changes.some((c) => c.field === "value"))
      : undefined);
  if (swap) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page
      .locator(`.part-row[data-id=${JSON.stringify(swap.id)}]`)
      .press("Enter");
    for (const c of swap.changes.filter((c) =>
      ["value", "footprint"].includes(c.field),
    )) {
      assert.ok(
        (await page.locator(".swap-context").innerText()).includes(
          `${c.before} → ${c.after}`,
        ),
      );
    }
    assert.ok(
      (await page.locator(".swap-context").boundingBox()).y < 450,
      "part replacement context appears above the long pin table",
    );
    if (changedPins(swap).length)
      assert.match(
        await page.locator(".semantic tr").nth(1).innerText(),
        /^Pin /,
      );
    assert.equal(
      await page.locator(".semantic tr").filter({ hasText: /^Pin / }).count(),
      changedPins(swap).length,
    );
    await page.mouse.move(1, 1);
    await capture("u17-inspector");
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 720 }]) {
      await page.setViewportSize(viewport);
      const first = await page.locator(".semantic tr").nth(1).boundingBox();
      assert.ok(first.y >= 0 && first.y + first.height <= viewport.height,
        "the first semantic change is visible on a laptop");
      assert.ok(!(await page.locator("#impact").isVisible()));
      await page.waitForFunction(() => {
        const regions = [...document.querySelectorAll(".region svg")];
        return regions.length === 2 && regions.every((svg) =>
          svg.getBoundingClientRect().height === 120,
        );
      });
      assert.equal(await page.locator('.region svg[data-revision="before"]').count(), 1);
      if (viewport.width === 1024) await capture("laptop-inspector");
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.keyboard.press("Escape");
  }
  const tinted = (cells) =>
    cells.evaluateAll((nodes) =>
      nodes.filter((node) => getComputedStyle(node).backgroundColor !== "rgba(0, 0, 0, 0)").length,
    );
  for (const status of ["modified", "added", "removed"]) {
    const row = page.locator(`.part-row.${status}`).first();
    if (await row.count()) {
      await row.click();
      assert.equal(
        await page.locator(".diff-header small").innerText(),
        status,
      );
      assert.ok((await page.locator(".semantic tr").count()) > 1);
      if (status !== "modified") {
        const missing = status === "added" ? 2 : 3;
        assert.ok((await page.locator(`.semantic td:nth-child(${missing}).absent`).count()) > 0);
        assert.equal(await tinted(page.locator(`.semantic td:nth-child(${missing})`)), 0,
          "the revision without the part carries no diff color");
      }
      await page.keyboard.press("Escape");
    }
  }
  const untouched = report.parts.find((p) => p.status === "unchanged");
  if (untouched) {
    await page.locator(`.tile[data-id=${JSON.stringify(untouched.id)}]`).click();
    assert.equal(await tinted(page.locator(".semantic td")), 0,
      "an unchanged part's table has no red or green cells");
    await page.keyboard.press("Escape");
  }
  if (report.head === "3bdc5547004c8244de5f37104410c363854e5634" &&
      report.boards.includes("hardware/hackrf-one/hackrf-one.kicad_pcb")) {
    for (const ref of ["P69", "C159"]) {
      const p = report.parts.find((part) => part.ref === ref);
      await page.locator(`.part-row[data-id=${JSON.stringify(p.id)}]`).press("Enter");
      if (ref === "P69") {
        assert.equal(await page.locator(".priority-tag").innerText(), "Metadata");
        assert.match(await page.locator(".classification-note").innerText(), /Verified legacy assembly-metadata migration/);
        await capture("classification");
      } else {
        assert.match(await page.locator(".diff-summary").innerText(), /population/);
        assert.match(await page.locator(".diff-summary").innerText(), /part identifier/);
      }
      await page.keyboard.press("Escape");
    }
  }
  await page.locator(".group-title").first().click();
  await page.mouse.move(1, 1);
  await previewSettled(null);
  assert.equal(await page.locator("#connections path").count(), 0,
    "mouse drill-in does not keep an unrequested first-component reach");
  await goHome(page);
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
  const depth = () =>
    page.locator("#breadcrumbs > span").evaluateAll((nodes) =>
      nodes.filter((node) => node.textContent === "/").length);
  const drilled = await depth();
  await page.keyboard.press("Escape");
  assert.equal(await depth(), drilled, "the first Escape only clears the focused part's trace");
  assert.equal(await page.locator(".tile.hovered").count(), 0);
  await page.keyboard.press("Escape");
  assert.equal(await depth(), 0, "Escape with nothing traced steps out of the drilled group");
  assert.ok(await page.evaluate(() => document.activeElement.classList.contains("group-title")),
    "stepping out focuses the group that was open");
  await page.locator("#search").fill(candidate.ref);
  assert.ok((await page.locator(".tile").count()) < report.parts.length);
  if (report.stats.changed) {
    // Pick the reference from the unfiltered list, so a changed part is always found.
    await page.locator("#search").fill("");
    const first = await page.locator(".part-row").first().getAttribute("data-id");
    const sought = report.parts.find((p) => p.id === first);
    await page.locator("#search").fill(sought.ref);
    const sections = await page.locator(".list-heading").evaluateAll((nodes) =>
      nodes.map((node) => node.firstChild.textContent));
    assert.equal(sections[0], "Exact match", "a searched reference leads the list in its own section");
    assert.equal(new Set(sections).size, sections.length, "no group heading repeats");
    assert.deepEqual(
      await page.locator(".list-heading .group-count").evaluateAll((nodes) =>
        nodes.map((node) => Number(node.textContent))),
      await page.locator("#part-list").evaluate((list) => {
        const counts = [];
        for (const node of list.children)
          if (node.matches(".list-heading")) counts.push(0);
          else if (node.matches(".part-row")) counts[counts.length - 1]++;
        return counts;
      }),
      "each heading counts the rows under it");
  }
  await page.locator("#search").fill("no-component-matches-this");
  await page.locator("#map-empty").waitFor({ state: "visible" });
  await page.locator("#search").fill("");
  await page.locator("#only-changed").uncheck();
  assert.equal(await page.locator(".part-row").count(), report.parts.length);
  await page.locator("#board-tab").click();
  const populatedBoards = [...new Set(report.parts.map((p) => p.file))];
  if (populatedBoards.length > 1) {
    const choices = page.locator(".board-chooser button");
    assert.equal(await choices.count(), populatedBoards.length);
    await page.locator(`.part-row[data-id=${JSON.stringify(candidate.id)}]`).click();
    await page.locator(".close-diff").click();
    await page.waitForTimeout(500);
    assert.equal(await choices.count(), 0, "list inspection chooses its board for return");
    await assertReturnedPart(page, candidate.id);
    assert.ok(await page.locator(`.tile[data-id=${JSON.stringify(candidate.id)}]`).isVisible());
    await capture("board-list-return");
    await goHome(page);
    await page.locator(`.part-row[data-id=${JSON.stringify(candidate.id)}]`).press("Enter");
    await page.locator(".reach-details > summary").click();
    const neighbor = page.locator(".reach-part").first();
    await neighbor.waitFor();
    const neighborId = await neighbor.getAttribute("data-id");
    await neighbor.click();
    await page.locator(".close-diff").click();
    assert.equal(await choices.count(), 0, "following a neighbor chooses its board for return");
    assert.equal(await page.evaluate(() => document.activeElement.dataset.id), neighborId,
      "Back focuses the exact neighbor instead of the board-view tab");
    await assertReturnedPart(page, neighborId);
    assert.ok(await page.locator(`.tile[data-id=${JSON.stringify(neighborId)}]`).isVisible());
    await capture("board-neighbor-return");
    await goHome(page);
    for (const file of populatedBoards) {
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
      await goHome(page);
    }
    await page
      .getByRole("button", { name: populatedBoards.at(-1), exact: true })
      .click();
  }
  assert.doesNotMatch(
    await page.locator("#map-scale-note").innerText(),
    /numbered pads/,
  );
  const board = await page.evaluate(() => {
    const frame = document.querySelector(".board-frame").getBoundingClientRect();
    const tiles = [...document.querySelectorAll("#tiles .tile")];
    const inside = (box) => box.left >= frame.left - 1 && box.right <= frame.right + 1 &&
      box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1;
    return {
      framed: tiles.every((tile) => inside(tile.getBoundingClientRect())),
      smallest: Math.min(...tiles.filter((tile) => tile.matches(".electrical, .added:not(.metadata), .removed:not(.metadata)"))
        .map((tile) => Math.min(tile.offsetWidth, tile.offsetHeight))),
      areas: tiles.map((tile) => {
        const box = tile.getBoundingClientRect();
        return box.width * box.height;
      }),
      overlaps: (() => {
        // Changes drawn larger than their footprint were spread. Count the pairs still covering each other.
        const small = tiles
          .filter((tile) => tile.dataset.enlarged)
          .map((tile) => tile.getBoundingClientRect());
        let count = 0;
        for (let i = 0; i < small.length; i++)
          for (let j = i + 1; j < small.length; j++)
            if (small[i].left < small[j].right - 1 && small[j].left < small[i].right - 1 &&
                small[i].top < small[j].bottom - 1 && small[j].top < small[i].bottom - 1) count++;
        return count;
      })(),
      named: tiles.filter((tile) => tile.querySelector(".ref") ||
        tile.nextElementSibling?.classList.contains("board-label")).length,
      sizes: Object.fromEntries(tiles.map((tile) =>
        [tile.dataset.id, [tile.offsetWidth, tile.offsetHeight]])),
    };
  });
  assert.ok(board.framed, "every footprint sits inside the board frame");
  assert.ok(board.smallest >= 11, "electrical changes keep a selectable marker");
  // Markers run largest to smallest, then the enlarged changes, which start a new run.
  assert.ok(board.areas.filter((area, index) => index && area > board.areas[index - 1] + 0.5).length <= 1,
    "smaller markers are drawn above larger ones, with enlarged changes on top");
  // A cluster too dense for the 18px limit may keep a few overlaps. Most pairs must be clear.
  assert.ok(board.overlaps <= Math.ceil(board.named / 20),
    `clustered small changes are spread apart: ${board.overlaps} overlapping pairs`);
  // Outside labels are promised only for electrical changes, so an unchanged board may have none.
  if (report.parts.some((p) => board.sizes[p.id] && isElectrical(p)))
    assert.ok(board.named > 0, "the board names its electrical changes");
  // The widest footprint in view keeps its own proportions.
  const widest = report.parts
    .filter((p) => board.sizes[p.id])
    .map((p) => {
      const extent = footprintExtent(p);
      return { id: p.id, w: extent.maxX - extent.minX, h: extent.maxY - extent.minY };
    })
    .sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const [markerWidth, markerHeight] = board.sizes[widest.id];
  // A marker at its minimum size no longer has its footprint's proportions.
  if (Math.min(markerWidth, markerHeight) > 16)
    assert.ok(Math.abs(markerWidth / markerHeight - widest.w / widest.h) <= 0.15 * (widest.w / widest.h),
      "a marker follows its footprint's extent");
  const tall = await page.locator("#tiles .tile").evaluateAll((tiles) => {
    const outer = tiles[0].getBoundingClientRect();
    const inner = tiles.slice(1).find((tile) => {
      const box = tile.getBoundingClientRect();
      return box.left >= outer.left && box.right <= outer.right &&
        box.top >= outer.top && box.bottom <= outer.bottom;
    });
    if (!inner) return null;
    const box = inner.getBoundingClientRect();
    return { id: inner.dataset.id, x: box.x + box.width / 2, y: box.y + box.height / 2,
      ox: outer.x + 2, oy: outer.y + 2, outer: tiles[0].dataset.id };
  });
  if (tall) {
    await page.mouse.move(tall.ox, tall.oy);
    await page.mouse.move(tall.ox + 1, tall.oy + 1);
    await previewSettled(tall.outer);
    assert.equal(await page.evaluate(({ x, y }) =>
      document.elementFromPoint(x, y).closest(".tile")?.dataset.id, tall), tall.id,
      "hovering a large footprint leaves the parts inside it reachable");
    await page.mouse.move(1, 1);
    await previewSettled(null);
  }
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.locator("#map-scale-note").isVisible(),
      `the board view states its limits at ${width}px`);
  }
  // On a phone the canvas takes the board's shape, and labels stay off names drawn in markers.
  await page.evaluate(() =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const phoneBoard = await page.evaluate(() => {
    const frame = document.querySelector(".board-frame").getBoundingClientRect(),
      canvas = document.getElementById("canvas").getBoundingClientRect();
    const range = document.createRange();
    const names = [...document.querySelectorAll("#tiles .tile .ref")].map((name) => {
      range.selectNodeContents(name);
      return range.getBoundingClientRect();
    });
    const covered = [...document.querySelectorAll(".board-label")].filter((label) => {
      const box = label.getBoundingClientRect();
      return names.some((name) => box.left < name.right && box.right > name.left &&
        box.top < name.bottom && box.bottom > name.top);
    }).length;
    return { slack: canvas.height - frame.height, height: canvas.height, covered };
  });
  assert.ok(phoneBoard.slack <= 190 || phoneBoard.height <= 200,
    `the phone board canvas follows the board's shape: ${JSON.stringify(phoneBoard)}`);
  assert.equal(phoneBoard.covered, 0, "no label covers a reference drawn inside a marker");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await capture("board");
  await page.locator("#map-tab").click();
  if (report.boards.length === 1) {
    await goHome(page);
    const sheets = await page.locator(".group-title").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label")),
    );
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 720 }]) {
      await page.setViewportSize(viewport);
      for (const name of sheets) {
        await page.getByRole("button", { name, exact: true }).click();
        await assertSheetReferences(page);
        const target = page.locator(".tile").last();
        await target.scrollIntoViewIfNeeded();
        await page.mouse.move(1, 1);
        await previewSettled(null);
        if (viewport.width === 1280) {
          if (name === sheets[0]) await capture("readable-sheet");
          if (name === "Open Root sheet") await capture("readable-root");
        }
        await hoverPart(target);
        const before = await target.boundingBox();
        const scroll = await page.locator("#map-panel").evaluate((node) => node.scrollTop);
        const id = await target.getAttribute("data-id");
        await target.click();
        await page.locator(".close-diff").click();
        await assertReturnedPart(page, id);
        const after = await target.boundingBox();
        const returnedScroll = await page.locator("#map-panel").evaluate((node) => node.scrollTop);
        assert.ok(Math.abs(after.y - before.y) <= 1,
          `Back keeps the selected component in place: ${JSON.stringify({ name, viewport, before, after, scroll, returnedScroll })}`);
        assert.ok(Math.abs(returnedScroll - scroll) <= 1);
        assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight),
          "desktop sheets scroll inside the map instead of the page");
        await goHome(page);
      }
    }
  }
  for (const width of [720, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    if (report.sheetRenames?.length || report.netRenames?.length) {
      await page.locator("#renames-toggle").click();
      const bounds = await page.locator("#renames").boundingBox();
      assert.ok(
        bounds.x >= 0 && bounds.x + bounds.width <= width &&
          bounds.y >= 0 && bounds.y + bounds.height <= 844,
        "label rename panel stays inside the viewport",
      );
      await page.keyboard.press("Escape");
      await page.locator("#renames").waitFor({ state: "hidden" });
    }
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `no horizontal overflow at ${width}px`,
    );
    assert.ok(
      await page.evaluate(() => {
        const boxes = [...document.querySelectorAll(".map-settings label, .view-tabs")]
          .map((node) => node.getBoundingClientRect());
        return boxes.every((a, i) => boxes.every((b, j) => i === j ||
          a.right <= b.left + 1 || b.right <= a.left + 1 ||
          a.bottom <= b.top + 1 || b.bottom <= a.top + 1));
      }),
      `map controls do not overlap at ${width}px`,
    );
  }
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "no mobile horizontal overflow",
  );
  if (report.boards.length === 1) {
    await goHome(page);
    // Measure in one pass, after the resized map has redrawn.
    await page.evaluate(() =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(
      await page.locator(".group-title").evaluateAll((titles) =>
        titles.every((title) => {
          const box = title.getBoundingClientRect();
          return box.width >= 60 && box.height >= 24;
        })),
      "small sheets retain visible drill targets",
    );
  }
  await capture("mobile");
  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const touchPage = await touch.newPage();
  touchPage.on("pageerror", (e) => errors.push(e.message));
  await touchPage.goto(`http://127.0.0.1:${server.address().port}`);
  const touchTile = touchPage.locator(
    `.tile[data-id=${JSON.stringify(candidate.id)}]`,
  );
  const touchCapture = async (name) => {
    if (shouldCapture(name))
      await touchPage.screenshot({
        path: `${out}/${name}.png`,
        animations: "disabled",
      });
  };
  await touchTile.waitFor();
  await touchCapture("touch-map");
  for (const width of [390, 320]) {
    await touchPage.setViewportSize({ width, height: 844 });
    assert.ok(await touchPage.locator("#impact").evaluate((box) =>
      box.scrollHeight <= box.clientHeight + 1),
      `the idle phone readout holds its sentence, key and starting parts at ${width}px`);
  }
  await touchPage.setViewportSize({ width: 390, height: 844 });
  // Let the resized map finish redrawing before tiles are measured and tapped.
  await touchPage.evaluate(() =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (renamedLabels.length) {
    const pill = await touchPage.locator("#renames-toggle").boundingBox();
    for (const offset of [-20, 20]) {
      await touchPage.touchscreen.tap(pill.x + pill.width / 2, pill.y + pill.height / 2 + offset);
      assert.ok(await touchPage.locator("#renames").isVisible(),
        "the rename control accepts touches across a 44px tall target");
      await touchPage.locator(".renames-close").tap();
      await touchPage.locator("#renames").waitFor({ state: "hidden" });
    }
    await touchPage.locator("#renames-toggle").tap();
    await touchCapture("touch-renames");
    await touchPage.locator("#stats .changed").tap();
    await touchPage.locator("#renames").waitFor({ state: "hidden" });
  }
  const tapSamePoint = async () => {
    await touchTile.scrollIntoViewIfNeeded();
    const box = await touchTile.boundingBox();
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await touchPage.touchscreen.tap(x, y);
    return { x, y };
  };
  await tapSamePoint();
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
  await assertLeadingNetsOnOneLine(touchPage);
  await touchPage.locator("#ground").tap();
  assert.deepEqual(
    await touchPage.locator(".tile.affected").evaluateAll((nodes) =>
      nodes.map((node) => node.dataset.id).sort(),
    ),
    reach(report, candidate.id, { includeGround: true }).ids.sort(),
    "touching the ground control updates the current preview",
  );
  await touchPage.locator("#reach").dispatchEvent("pointerdown", {
    pointerType: "touch",
  });
  await touchPage.locator("#reach").selectOption("transitive");
  assert.match(
    await touchPage.locator("#impact").innerText(),
    /transitively reachable/,
  );
  assert.ok(
    await touchPage.locator(".open-preview").isVisible(),
    "touching reach settings preserves the preview action",
  );
  await assertReadoutFits(touchPage);
  await touchPage.locator("#reach").selectOption("direct");
  await touchPage.locator("#ground").tap();
  await touchCapture("touch-reach");
  const mixedPart = report.parts
    .filter((p) => p.id !== candidate.id)
    .sort((a, b) => Object.keys(b.pins).length - Object.keys(a.pins).length)[0];
  const mixedPark = await touchPage.locator(`.tile[data-id=${JSON.stringify(mixedPart.id)}]`).boundingBox();
  await touchPage
    .getByRole("button", { name: `Open ${candidate.ref} diff`, exact: true })
    .tap();
  assert.ok(
    await touchPage.locator("#diff-panel").isVisible(),
    "explicit action opens diff",
  );
  assert.ok(
    !(await touchPage.locator("#impact").isVisible()),
    "phone inspection gives the screen to the component rather than map controls",
  );
  assert.equal(
    await touchPage.evaluate(() => scrollY),
    0,
    "phone inspection starts at the top without cropping the app header",
  );
  const firstPin = await touchPage.locator(".semantic tr").nth(1).boundingBox();
  assert.ok(
    firstPin.y >= 0 && firstPin.y + firstPin.height <= 844,
    "first semantic change fits on the initial phone screen",
  );
  await touchCapture("touch-diff");
  assert.ok(
    await touchPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "touch inspector has no horizontal overflow",
  );
  await touchPage.mouse.move(mixedPark.x + mixedPark.width / 2, mixedPark.y + mixedPark.height / 2);
  await touchPage.locator(".close-diff").tap();
  await touchPage.waitForTimeout(500);
  await assertReturnedPart(touchPage, candidate.id);
  assert.ok(
    await touchPage.getByRole("button", { name: `Open ${candidate.ref} diff`, exact: true }).isVisible(),
    "the returned part keeps its inspect action on a touch screen",
  );
  await touchPage.keyboard.press("Escape");
  const point = await tapSamePoint();
  const previewBox = await touchTile.boundingBox();
  assert.ok(
    point.x >= previewBox.x &&
      point.x <= previewBox.x + previewBox.width &&
      point.y >= previewBox.y &&
      point.y <= previewBox.y + previewBox.height,
    "preview keeps the original physical tap point inside the same tile",
  );
  assert.equal((await touchPage.locator("#impact").boundingBox()).height, 132);
  await touchPage.touchscreen.tap(point.x, point.y);
  assert.ok(
    await touchPage.locator("#diff-panel").isVisible(),
    "second touch tap inspects",
  );
  assert.equal(
    await touchPage
      .locator(".diff-header h2")
      .evaluate((n) => n.firstChild.textContent),
    candidate.ref,
    "the physical second tap inspects the original component",
  );
  await touchPage.locator(".close-diff").tap();
  await touchPage.locator("#toggle-changes").tap();
  assert.equal(
    await touchPage.locator("#toggle-changes").getAttribute("aria-expanded"),
    "true",
  );
  if (!report.stats.changed) await touchPage.locator("#only-changed").uncheck();
  if ((await touchPage.locator(".part-row").count()) > 12)
    assert.ok((await touchPage.locator("#part-list").boundingBox()).height >= 380,
      "the expanded phone list shows many changes at once");
  await touchPage.locator(".part-row").first().tap();
  assert.ok(
    await touchPage.locator("#map-panel").isVisible(),
    "touch sidebar previews before inspection",
  );
  assert.ok(await touchPage.locator(".open-preview").isVisible());
  const listOrigin = await touchPage
    .locator(".part-row")
    .first()
    .getAttribute("data-id");
  await touchPage.locator(".open-preview").tap();
  assert.equal(
    await touchPage.locator("#toggle-changes").getAttribute("aria-expanded"),
    "false",
    "opening from expanded changes collapses the phone list",
  );
  const headBox = await touchPage.locator(".diff-header").boundingBox();
  assert.ok(
    headBox.y >= 0 && headBox.y + headBox.height <= 844,
    "inspector header comes into view",
  );
  assert.equal(
    await touchPage
      .locator("#diff-panel")
      .evaluate((n) => getComputedStyle(n).overflowY),
    "visible",
    "phone inspector uses document scrolling",
  );
  await touchPage.locator(".close-diff").tap();
  assert.equal(
    await touchPage.evaluate(() => document.activeElement.dataset.id),
    listOrigin,
    "phone Back focuses the originating component's map tile",
  );
  const canvasBox = await touchPage.locator("#canvas").boundingBox();
  assert.ok(
    canvasBox.y >= 0 && canvasBox.y + canvasBox.height <= 844,
    "Back brings the map into view",
  );
  // The returned part is still previewed. Clear it so the next tap starts a fresh preview.
  await touchPage.keyboard.press("Escape");
  await tapSamePoint();
  // Keep this outside tap away from the browser's expanded disclosure target.
  await touchPage.locator("#stats .changed").tap();
  assert.equal(
    await touchPage.locator(".open-preview").count(),
    0,
    "outside touch dismisses preview",
  );
  await touchPage.locator("#board-tab").tap();
  if (populatedBoards.length === 1) {
    // A touch just beside a small change picks that change.
    const miss = await touchPage.locator(".tile[data-enlarged]").evaluateAll((tiles) => {
      const boxes = tiles.map((tile) => tile.getBoundingClientRect());
      const gap = (box, x, y) => Math.hypot(
        Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));
      for (const [index, box] of boxes.entries())
        for (const [dx, dy] of [[-9, 0], [9, 0], [0, -9], [0, 9]]) {
          const x = dx < 0 ? box.left + dx : dx > 0 ? box.right + dx : box.left + box.width / 2,
            y = dy < 0 ? box.top + dy : dy > 0 ? box.bottom + dy : box.top + box.height / 2;
          if (boxes.every((other, at) => at === index || gap(other, x, y) > gap(box, x, y) + 2) &&
              !document.elementFromPoint(x, y)?.closest(".tile[data-enlarged]") &&
              document.elementFromPoint(x, y)?.closest("#tiles"))
            return { id: tiles[index].dataset.id, x, y };
        }
      return null;
    });
    if (miss) {
      await touchPage.touchscreen.tap(miss.x, miss.y);
      assert.equal(await touchPage.locator(".tile.hovered").getAttribute("data-id"), miss.id,
        "a touch within 22px of a small board change previews that change");
      assert.ok(await touchPage.locator(".open-preview").isVisible());
      await touchPage.touchscreen.tap(miss.x, miss.y);
      assert.equal(await touchPage.locator("#diff-panel").getAttribute("data-id"), miss.id,
        "a second near touch inspects it");
      await touchPage.locator(".close-diff").tap();
      await touchPage.keyboard.press("Escape");
    }
    // A tap in a cluster lists the changes around it as full-size buttons.
    const cluster = await touchPage.locator(".tile[data-enlarged]").evaluateAll((tiles) => {
      const boxes = tiles.map((tile) => tile.getBoundingClientRect());
      for (const [index, box] of boxes.entries()) {
        const x = box.left + box.width / 2, y = box.top + box.height / 2;
        const close = boxes.filter((other) => Math.hypot(
          Math.max(other.left - x, 0, x - other.right), Math.max(other.top - y, 0, y - other.bottom)) <= 30);
        if (close.length >= 2 && document.elementFromPoint(x, y) === tiles[index])
          return { id: tiles[index].dataset.id, x, y };
      }
      return null;
    });
    assert.ok(await touchPage.locator("#nearby").isVisible(),
      "the touch board view reserves a strip for nearby changes");
    if (cluster) {
      const strip = await touchPage.locator("#nearby").boundingBox();
      await touchPage.touchscreen.tap(cluster.x, cluster.y);
      const picks = touchPage.locator("#nearby button");
      await picks.first().waitFor();
      assert.ok((await picks.count()) >= 2, "a tap in a cluster lists the changes around it");
      assert.equal(await picks.first().getAttribute("data-id"), cluster.id,
        "the tapped change leads the nearby list");
      assert.ok(await picks.evaluateAll((buttons) =>
        buttons.every((button) => button.getBoundingClientRect().height >= 44)),
        "nearby changes are full-size touch targets");
      assert.equal((await touchPage.locator("#nearby").boundingBox()).y, strip.y,
        "listing nearby changes does not move the board");
      const second = await picks.nth(1).getAttribute("data-id");
      await picks.nth(1).tap();
      assert.equal(await touchPage.locator(".tile.hovered").getAttribute("data-id"), second,
        "choosing a nearby change previews it");
      await picks.nth(1).tap();
      assert.equal(await touchPage.locator("#diff-panel").getAttribute("data-id"), second,
        "choosing it again inspects it");
      await touchPage.locator(".close-diff").tap();
      await touchPage.keyboard.press("Escape");
    }
    // A changed part only a few markers wide keeps its own face clear of spread markers.
    const buried = await touchPage.locator("#tiles .tile:not(.unchanged):not(.metadata):not([data-enlarged])")
      .evaluateAll((tiles) => tiles.filter((tile) => {
        const box = tile.getBoundingClientRect();
        if (Math.max(box.width, box.height) > 44) return false;
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit?.closest(".tile[data-enlarged]");
      }).map((tile) => tile.title.split(" · ")[0]));
    assert.deepEqual(buried, [], "no small enlarged marker sits on the center of a mid-size change");
    // A direct touch on a full-size change is never handed to a small neighbor.
    const direct = await touchPage.locator("#tiles .tile:not(.unchanged):not(.metadata):not([data-enlarged])")
      .evaluateAll((tiles) => {
        for (const tile of tiles) {
          const box = tile.getBoundingClientRect();
          for (const [fx, fy] of [[0.5, 0.5], [0.2, 0.2], [0.8, 0.8], [0.2, 0.8], [0.8, 0.2]]) {
            const x = box.left + box.width * fx, y = box.top + box.height * fy;
            if (document.elementFromPoint(x, y) === tile ||
                document.elementFromPoint(x, y)?.parentElement === tile)
              return { id: tile.dataset.id, x, y };
          }
        }
        return null;
      });
    if (direct) {
      await touchPage.touchscreen.tap(direct.x, direct.y);
      assert.equal(await touchPage.locator(".tile.hovered").getAttribute("data-id"), direct.id,
        "a direct touch on a full-size change previews that part");
      await touchPage.keyboard.press("Escape");
    }
  }
  if (populatedBoards.length > 1) {
    await touchPage.locator("#toggle-changes").tap();
    await touchPage.locator("#only-changed").uncheck();
    const row = touchPage.locator(`.part-row[data-id=${JSON.stringify(candidate.id)}]`);
    await row.tap();
    await row.tap();
    await touchPage.locator(".close-diff").tap();
    await touchPage.waitForTimeout(500);
    assert.equal(await touchPage.locator(".board-chooser button").count(), 0,
      "phone list inspection chooses the originating board");
    await assertReturnedPart(touchPage, candidate.id);
    assert.equal(await touchPage.evaluate(() => document.activeElement.dataset.id), candidate.id);
    await touchCapture("touch-board-list-return");
  }
  await touchPage.locator("#map-tab").tap();
  await tapSamePoint();
  await touchPage.keyboard.press("Escape");
  assert.equal(
    await touchPage.locator(".open-preview").count(),
    0,
    "Escape dismisses touch preview",
  );

  if (report.boards.length === 1) {
    await goHome(touchPage);
    const canvasTop = (await touchPage.locator("#canvas").boundingBox()).y;
    assert.ok(canvasTop <= 340, `the phone map starts in the upper 40% of the screen, at ${canvasTop}px`);
    const sliver = await touchPage.locator(".group .tile").evaluateAll((nodes) =>
      nodes.find((node) => {
        const box = node.getBoundingClientRect();
        return Math.min(box.width, box.height) < 20;
      })?.dataset.id);
    if (sliver) {
      await touchPage.locator(`.tile[data-id=${JSON.stringify(sliver)}]`).tap();
      assert.match(await touchPage.locator("#breadcrumbs").innerText(), /\//,
        "tapping a part too small for a fingertip opens its sheet");
      assert.equal(await touchPage.locator(".tile.hovered").getAttribute("data-id"), sliver,
        "the tapped part stays marked in its opened sheet");
      assert.ok(await touchPage.locator(".open-preview").isVisible(),
        "the tapped part is previewed with its inspect action");
      const kept = await touchPage.locator(`.tile[data-id=${JSON.stringify(sliver)}]`).boundingBox(),
        cover = await touchPage.locator("#impact").boundingBox();
      assert.ok(kept.y >= cover.y + cover.height && kept.y + kept.height <= 844,
        "the tapped part is scrolled into view below the readout");
      await touchPage.keyboard.press("Escape");
      const sides = await touchPage.locator(".tile").evaluateAll((nodes) =>
        nodes.map((node) => Math.min(node.getBoundingClientRect().width, node.getBoundingClientRect().height)));
      assert.ok(sides.every((side) => side >= 32), "the opened sheet gives every part a full touch target");
      await goHome(touchPage);
    }
    await touchPage.locator(".group-title").first().tap();
    const targets = await touchPage.locator(".tile").evaluateAll((nodes) => nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { id: node.dataset.id, side: Math.min(box.width, box.height) };
    }));
    assert.ok(targets.every((tile) => tile.side >= 32), "drilled phone parts have 32px touch targets");
    if (report.head === "3bdc5547004c8244de5f37104410c363854e5634" &&
        report.boards.includes("hardware/hackrf-one/hackrf-one.kicad_pcb")) {
      const regulator = report.parts.find((p) => p.ref === "U21");
      const regulatorTile = touchPage.locator(`.tile[data-id=${JSON.stringify(regulator.id)}]`);
      await regulatorTile.scrollIntoViewIfNeeded();
      await regulatorTile.tap();
      await assertReadoutFits(touchPage);
      await touchPage.keyboard.press("Escape");
    }
    const smallest = targets.sort((a, b) => a.side - b.side)[0];
    const small = touchPage.locator(`.tile[data-id=${JSON.stringify(smallest.id)}]`);
    await small.scrollIntoViewIfNeeded();
    await touchCapture("touch-sheet");
    const box = await small.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    await touchPage.touchscreen.tap(x, y);
    const stickyReadout = await touchPage.locator("#impact").boundingBox();
    const inspectAction = await touchPage.locator(".open-preview").boundingBox();
    assert.ok(stickyReadout.y >= 0 && stickyReadout.y + stickyReadout.height <= 844,
      "the readout stays visible in a scrolled phone sheet");
    assert.ok(inspectAction.y >= stickyReadout.y &&
      inspectAction.y + inspectAction.height <= stickyReadout.y + stickyReadout.height,
      "the phone inspect action stays inside the visible readout");
    assert.ok(y > stickyReadout.y + stickyReadout.height,
      "the sticky readout does not cover the original tap point");
    await assertReadoutFits(touchPage);
    await touchCapture("touch-sheet-preview");
    await touchPage.touchscreen.tap(x, y);
    await touchPage.locator("#diff-panel").waitFor({ state: "visible" });
    assert.equal(await touchPage.locator("#diff-panel").getAttribute("data-id"), smallest.id,
      "two physical taps inspect the same small component");
    await touchPage.locator(".close-diff").tap();
    assert.equal(await touchPage.evaluate(() => document.activeElement.dataset.id), smallest.id);
    await assertReturnedPart(touchPage, smallest.id);
    await touchCapture("touch-return");
    const restored = await small.boundingBox();
    assert.ok(restored.y >= 0 && restored.y + restored.height <= 844,
      "Back restores the selected target inside the long sheet map");
  }

  if (report.boards.length === 1) {
    await goHome(touchPage);
    const names = await touchPage.locator(".group-title").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label")),
    );
    for (const name of names) {
      await touchPage.getByRole("button", { name, exact: true }).tap();
      await assertSheetReferences(touchPage);
      if (name === "Open Root sheet") {
        await touchPage.locator(".tile").last().tap();
        await assertReadoutFits(touchPage);
        await touchCapture("touch-root");
      }
      await goHome(touchPage);
    }
  }
  await touch.close();
  for (const [width, hasTouch] of [[701, false], [720, false], [768, false], [900, false], [768, true]]) {
    const tablet = await browser.newContext({
      viewport: { width, height: hasTouch ? 1024 : 900 },
      hasTouch,
      isMobile: hasTouch,
      reducedMotion: "reduce",
    });
    const surface = await tablet.newPage();
    surface.on("pageerror", (e) => errors.push(e.message));
    await surface.goto(`http://127.0.0.1:${server.address().port}`);
    const subject = surface.locator(`.tile[data-id=${JSON.stringify(candidate.id)}]`);
    await subject.waitFor();
    if (hasTouch) {
      await subject.tap();
      await subject.tap();
      await surface.locator(".close-diff").tap();
    } else {
      await subject.click();
      await surface.locator(".close-diff").click();
    }
    await surface.waitForTimeout(500);
    await assertReturnedPart(surface, candidate.id);
    assert.equal(await surface.evaluate(() => document.activeElement.dataset.id), candidate.id,
      "tablet resize preserves focus on the returned part");
    if (width === 720 && shouldCapture("tablet-return"))
      await surface.screenshot({ path: `${out}/tablet-return.png`, animations: "disabled" });
    await tablet.close();
  }
  if (values.fixture && !values.removed) {
    // Exercise presentation-only cases without changing the engine fixture or classification.
    const presentationReport = structuredClone(report);
    const subject = presentationReport.parts.find((p) => p.id === candidate.id);
    subject.ref = "ZD1";
    subject.changes.push({
      field: "pins",
      before: { 2: ["GND"] },
      after: { 2: ["VBUS"] },
    });
    subject.changes.push({
      field: "attributes",
      before: [],
      after: [
        "smd",
        "through_hole",
        "exclude_from_bom",
        "exclude_from_pos_files",
        "dnp",
      ],
    });
    const fields = subject.changes.find((c) => c.field === "fields");
    fields.before.Empty = "";
    fields.after.Absent = "";
    const removed = presentationReport.parts.find(
      (p) => p.status === "removed",
    );
    removed.path = "/proven-sheet/removed-component";
    removed.sheet = "FrontEnd";
    const lookalike = structuredClone(removed);
    lookalike.id += "-other-sheet";
    lookalike.ref = "C99";
    lookalike.path = "/different-sheet/other-component";
    presentationReport.parts.push(lookalike);
    presentationReport.sheetRenames = [
      {
        file: removed.file,
        path: "/proven-sheet",
        before: "FrontEnd",
        after: "frontend",
      },
    ];
    presentationReport.netRenames = Array.from({ length: 60 }, (_, i) => ({
      file: removed.file,
      before: `/Microcontroller, CPLD, USB, Power/LEGACY_SIGNAL_${i}`,
      after: `Net-(U${i}-Pad${i})`,
    }));
    const proof = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    proof.on("pageerror", (e) => errors.push(e.message));
    await proof.route("**/api/report", (route) =>
      route.fulfill({ json: presentationReport }),
    );
    await proof.goto(`http://127.0.0.1:${server.address().port}`);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 600 }]) {
      await proof.setViewportSize(viewport);
      await proof.locator("#renames-toggle").click();
      const long = await proof.locator("#renames").boundingBox();
      assert.ok(long.y >= 0 && long.y + long.height <= viewport.height &&
          long.x >= 0 && long.x + long.width <= viewport.width,
        "a long rename list stays inside the viewport");
      assert.ok(await proof.locator(".renames-body").evaluate((node) =>
        node.scrollHeight > node.clientHeight), "a long rename list scrolls inside its panel");
      assert.ok(await proof.locator(".renames-close").isVisible(),
        "the close control stays visible above a long rename list");
      await proof.locator("#renames li").last().scrollIntoViewIfNeeded();
      const last = await proof.locator("#renames li").last().boundingBox();
      assert.ok(last.y + last.height <= long.y + long.height + 1,
        "the last rename is reachable by scrolling the panel");
      await proof.keyboard.press("Escape");
      await proof.locator("#renames").waitFor({ state: "hidden" });
    }
    // A zoomed browser leaves little height. The panel shrinks instead of leaving the screen.
    await proof.setViewportSize({ width: 360, height: 200 });
    await proof.locator("#renames-toggle").click();
    const short = await proof.locator("#renames").boundingBox();
    assert.ok(short.y + short.height <= 200, "the rename panel never extends below a short viewport");
    await proof.keyboard.press("Escape");
    await proof.locator("#renames").waitFor({ state: "hidden" });
    await proof.setViewportSize({ width: 1440, height: 900 });
    await proof
      .locator(`.part-row[data-id=${JSON.stringify(subject.id)}]`)
      .press("Enter");
    const assembly = proof.locator(".semantic tr").filter({
      has: proof.getByRole("cell", { name: "Assembly", exact: true }),
    });
    assert.deepEqual(await assembly.locator("td").allTextContents(), [
      "Assembly",
      "None",
      "SMD, Through-hole, Not in BOM, Not in position file, DNP",
    ]);
    assert.doesNotMatch(
      await proof.locator(".diff-summary").innerText(),
      /Attributes/,
    );
    const property = (key) =>
      proof
        .locator(".semantic tr")
        .filter({
          has: proof.getByRole("cell", {
            name: `Property: ${key}`,
            exact: true,
          }),
        })
        .locator("td");
    assert.deepEqual(await property("Empty").allTextContents(), [
      "Property: Empty",
      '\"\" (empty string)',
      "∅",
    ]);
    assert.deepEqual(await property("Absent").allTextContents(), [
      "Property: Absent",
      "∅",
      '\"\" (empty string)',
    ]);
    assert.match(
      await proof.locator(".swap-context").innerText(),
      /5V regulator → 3V3 regulator/,
    );
    assert.deepEqual(
      await proof
        .locator(".semantic tr")
        .nth(1)
        .locator("td")
        .allTextContents(),
      ["Pin 2", "GND", "VBUS"],
      "ZD1 pin change remains first, ahead of the other semantic rows",
    );
    await proof.keyboard.press("Escape");
    await proof
      .getByRole("button", { name: `Open ${removed.file}`, exact: true })
      .press("Enter");
    const groupFor = (part) =>
      proof
        .locator(".group")
        .filter({
          has: proof.locator(`.tile[data-id=${JSON.stringify(part.id)}]`),
        })
        .locator(".group-title");
    assert.match(
      await groupFor(removed).innerText(),
      /frontend/,
      "removed part uses the proven sheet UUID's new display label",
    );
    assert.match(
      await groupFor(lookalike).innerText(),
      /FrontEnd/,
      "matching old label without the matching sheet UUID stays separate",
    );
    await groupFor(removed).press("Enter");
    assert.equal(
      await proof
        .locator(`.tile[data-id=${JSON.stringify(removed.id)}]`)
        .count(),
      1,
      "sheet scope includes the proven removed sheetmate",
    );
    assert.equal(
      await proof
        .locator(`.tile[data-id=${JSON.stringify(lookalike.id)}]`)
        .count(),
      0,
    );
    await proof.locator(".tile").press("Enter");
    assert.match(
      await proof.locator(".diff-subtitle").innerText(),
      /FrontEnd/,
      "raw removed sheet label remains available in the inspector",
    );
    await proof.close();
  }
  if (report.boards.length === 1 && new Set(report.parts.map((p) => p.sheet)).size > 1) {
    const moving = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    moving.on("pageerror", (e) => errors.push(e.message));
    await moving.goto(`http://127.0.0.1:${server.address().port}`);
    const sheet = moving.locator(".group-title").first(),
      sheetKey = await sheet.getAttribute("data-focus-key");
    await sheet.waitFor();
    for (const leave of [false, true]) {
      if (leave) await moving.locator("#breadcrumbs button").first().press("Enter");
      else await sheet.press("Enter");
      const zoomed = await moving.evaluate(() => {
        const [animation] = document.getElementById("tiles").getAnimations();
        return {
          zooming: document.getElementById("canvas").classList.contains("zooming"),
          scaled: animation?.effect.getKeyframes()[0].transform.includes("scale"),
        };
      });
      assert.deepEqual(zoomed, { zooming: true, scaled: true },
        `${leave ? "leaving" : "opening"} a sheet zooms the map between the sheet and the canvas`);
      await moving.waitForFunction(() =>
        !document.getElementById("canvas").classList.contains("zooming"));
      assert.equal(await moving.locator("#tiles").evaluate((node) => getComputedStyle(node).transform),
        "none", "the map rests untransformed after a zoom");
      if (leave)
        assert.equal(await moving.evaluate(() => document.activeElement.dataset.focusKey), sheetKey,
          "leaving a sheet returns focus to the sheet that was open");
      else {
        // Keyboard drill-in focuses a part during the zoom. Its curves must land on resting tiles.
        const ends = await moving.evaluate(() => {
          const canvas = document.getElementById("canvas").getBoundingClientRect();
          const tiles = [...document.querySelectorAll(".tile.affected")].map((tile) =>
            tile.getBoundingClientRect());
          return [...document.querySelectorAll("#connections .link")].map((path) => {
            const end = path.getPointAtLength(path.getTotalLength());
            const x = end.x + canvas.x, y = end.y + canvas.y;
            return tiles.some((tile) => x >= tile.left - 1 && x <= tile.right + 1 &&
              y >= tile.top - 1 && y <= tile.bottom + 1);
          });
        });
        assert.ok(ends.every(Boolean), "curves drawn after a zoom end on their resting tiles");
      }
    }
    await moving.close();
    // With motion on, a tapped sliver is still in view once its sheet has zoomed open.
    const swipe = await browser.newContext({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    });
    const hand = await swipe.newPage();
    hand.on("pageerror", (e) => errors.push(e.message));
    await hand.goto(`http://127.0.0.1:${server.address().port}`);
    await hand.locator(".tile").first().waitFor();
    const thin = await hand.locator(".group .tile").evaluateAll((nodes) =>
      nodes.findLast((node) => {
        const box = node.getBoundingClientRect();
        return Math.min(box.width, box.height) < 20;
      })?.dataset.id);
    if (thin) {
      await hand.locator(`.tile[data-id=${JSON.stringify(thin)}]`).tap();
      await hand.waitForFunction(() =>
        !document.getElementById("canvas").classList.contains("zooming"));
      const held = await hand.locator(`.tile[data-id=${JSON.stringify(thin)}]`).boundingBox();
      assert.ok(held.y >= 0 && held.y + held.height <= 844,
        "after the zoom the tapped part is in view");
      assert.ok(await hand.locator(".open-preview").isVisible());
    }
    await swipe.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    `PASS: ${report.parts.length} parts, ${report.stats.changed} changes; map, reach, transitive, ground, diff, drill-in, breadcrumbs, search, layout, mobile; no browser errors.`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  fixture?.cleanup();
}
