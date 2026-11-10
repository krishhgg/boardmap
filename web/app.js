import { reach } from "/compare.js";
import {
  orderedChanges,
  propertyPriority,
  changedPins,
  changeGroup,
  isElectrical,
  padGroups,
  changedPadNumbers,
  changedMechanicalPads,
} from "/review.js";
const $ = (id) => document.getElementById(id);
const el = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
};
const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const state = {
  scope: null,
  view: "map",
  selected: null,
  hover: null,
  touchPreview: null,
  query: "",
  transitive: false,
  includeGround: false,
  roving: { list: null, map: null },
  inspectOrigin: null,
  previewOrigin: null,
};
let report,
  parts,
  resize,
  mapSize = "";
const textMetrics = document.createElement("canvas").getContext("2d");
const weight = (p) => Math.max(3, Object.keys(p.pins).length);
const shortFile = (file) => file.split("/").at(-1).replace(".kicad_pcb", "");
const mark = (p) =>
  ({ modified: "~", added: "+", removed: "−", unchanged: "·" })[p.status];
// Native buttons form two linear roving groups, with one Tab stop per region.
function syncRoving(root, region) {
  const buttons = [...root.querySelectorAll("button")];
  const current =
    buttons.find(
      (button) => button.dataset.focusKey === state.roving[region],
    ) ?? buttons[0];
  for (const button of buttons) button.tabIndex = button === current ? 0 : -1;
  state.roving[region] = current?.dataset.focusKey ?? null;
}
function wireRoving(root, region) {
  root.addEventListener("focusin", (event) => {
    const button = event.target.closest("button");
    if (!button || !root.contains(button)) return;
    state.roving[region] = button.dataset.focusKey;
    syncRoving(root, region);
  });
  root.addEventListener("keydown", (event) => {
    const keys =
      region === "map"
        ? ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]
        : ["ArrowUp", "ArrowDown", "Home", "End"];
    if (
      !keys.includes(event.key) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const buttons = [...root.querySelectorAll("button")];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : Math.max(
              0,
              Math.min(
                buttons.length - 1,
                index + (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1),
              ),
            );
    buttons[next].focus();
  });
  if (region === "list")
    root.addEventListener("pointerleave", (event) => {
      if (event.pointerType !== "touch" && !state.touchPreview) {
        const focused = document.activeElement;
        if (root.contains(focused) && focused.dataset.id)
          highlight(focused.dataset.id);
        else resetImpact();
      }
    });
}
function partOrigin(node) {
  return {
    region: $("part-list").contains(node) ? "list" : "map",
    key: node.dataset.focusKey,
  };
}
function matches(p) {
  return `${p.ref} ${p.value} ${p.footprint} ${Object.values(
    p.before?.pins ?? {},
  )
    .flat()
    .join(" ")} ${Object.values(p.after?.pins ?? {})
    .flat()
    .join(" ")}`
    .toLowerCase()
    .includes(state.query);
}
function displaySheet(p) {
  if (p.status !== "removed" || !p.path) return p.sheet;
  const path = p.path.split("/").slice(0, -1).join("/");
  const labels = new Set(
    (report.sheetRenames ?? [])
      .filter(
        (rename) =>
          rename.file === p.file &&
          rename.path === path &&
          rename.before === p.sheet,
      )
      .map((rename) => rename.after),
  );
  return labels.size === 1 ? [...labels][0] : p.sheet;
}
function changeFields(p) {
  return orderedChanges(p).map(
    (c) =>
      propertyPriority(c) ??
      {
        pins: "pin nets",
        pads: "pad geometry",
        fields: "properties",
        attributes: "assembly",
        angle: "rotation",
      }[c.field] ??
      c.field,
  );
}
function inScope(p) {
  return (
    !state.scope ||
    (p.file === state.scope.file &&
      (!state.scope.sheet || displaySheet(p) === state.scope.sheet))
  );
}
function breadcrumb() {
  const nav = $("breadcrumbs");
  nav.replaceChildren();
  const home = el("button", "Whole design");
  home.title = "All selected boards and sheets";
  home.onclick = () => setScope(null);
  nav.append(home);
  if (state.scope) {
    nav.append(el("span", "/"));
    const board = el("button", shortFile(state.scope.file));
    board.title = state.scope.file;
    board.onclick = () => setScope({ file: state.scope.file });
    nav.append(board);
    if (state.scope.sheet) {
      nav.append(el("span", "/"));
      const sheet = el("span", state.scope.sheet);
      sheet.title = state.scope.sheet;
      nav.append(sheet);
    }
  }
}
function setScope(scope) {
  state.scope = scope;
  state.selected = null;
  $("diff-panel").hidden = true;
  $("map-panel").hidden = false;
  breadcrumb();
  renderList();
  renderMap();
  resetImpact();
  (
    $("tiles").querySelector(".tile, .board-chooser button") ??
    $("breadcrumbs").querySelector("button")
  ).focus();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
    $("tiles").animate(
      [
        { opacity: 0.4, transform: "scale(.98)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: 180, easing: "ease-out" },
    );
}
function renderList() {
  const list = $("part-list");
  list.replaceChildren();
  const shown = report.parts
    .filter(
      (p) =>
        inScope(p) &&
        matches(p) &&
        (!$("only-changed").checked || p.status !== "unchanged"),
    )
    .sort((a, b) => {
      const order = ["Electrical", "Removed", "Added", "Metadata", "Unchanged"];
      return (
        order.indexOf(changeGroup(a)) - order.indexOf(changeGroup(b)) ||
        changedPins(b).length - changedPins(a).length ||
        a.ref.localeCompare(b.ref, undefined, { numeric: true }) ||
        a.file.localeCompare(b.file)
      );
    });
  $("list-count").textContent = `${shown.length} shown`;
  let group;
  for (const p of shown) {
    const kind = changeGroup(p);
    if (kind !== group) {
      group = kind;
      const heading = el("h3", undefined, "list-heading");
      heading.append(
        el("span", group === "Electrical" ? "Electrical edits" : group),
        el(
          "span",
          shown.filter((p) => changeGroup(p) === group).length,
          "group-count",
        ),
      );
      heading.title =
        group === "Electrical"
          ? "Pin nets, pads, value, footprint, population or part identifier changes"
          : group === "Metadata"
            ? "Placement, properties, assembly and zero-pad artwork"
            : group;
      list.append(heading);
    }
    const row = el(
      "button",
      undefined,
      `part-row ${p.status}${isElectrical(p) ? " electrical" : ""}`,
    );
    row.dataset.changeGroup = kind;
    row.dataset.id = p.id;
    row.dataset.focusKey = `part:${p.id}`;
    row.classList.toggle("selected", state.selected === p.id);
    row.setAttribute(
      "aria-label",
      `${p.ref}, ${p.value}, ${p.status}, ${shortFile(p.file)}`,
    );
    row.append(el("span", mark(p), "status-mark"));
    const meta = el("span", undefined, "part-meta");
    meta.append(
      el("strong", p.ref),
      el(
        "small",
        `${p.value || p.footprint}${report.boards.length > 1 ? ` · ${shortFile(p.file)}` : ""}`,
      ),
    );
    if (p.status === "modified") {
      const fields = changeFields(p);
      const summary = el(
        "small",
        fields.slice(0, 3).join(" · ") +
          (fields.length > 3 ? ` +${fields.length - 3}` : ""),
        "row-summary",
      );
      summary.title = fields.join(", ");
      meta.append(summary);
    }
    row.append(meta);
    const rewired = changedPins(p).length;
    if (rewired) {
      const count = el(
        "span",
        `${rewired} ${rewired === 1 ? "pin" : "pins"}`,
        "rewired-count",
      );
      count.title = `${rewired} numbered ${rewired === 1 ? "pin has" : "pins have"} changed net connectivity`;
      row.append(count);
    }
    row.title = `${p.ref} · ${p.value || p.footprint} · ${p.status}
${orderedChanges(p)
  .map((c) => c.field)
  .join(", ")}`;
    wirePart(row, p);
    list.append(row);
  }
  if (!shown.length)
    list.append(
      el(
        "p",
        "No components match. Clear the search or include unchanged parts.",
        "empty",
      ),
    );
  syncRoving(list, "list");
}
function wirePart(node, p) {
  let touchClick = false;
  node.onpointerdown = (event) => {
    touchClick = event.pointerType === "touch";
  };
  node.onpointercancel = () => {
    touchClick = false;
  };
  node.onpointerenter = (event) => {
    if (event.pointerType !== "touch") highlight(p.id);
  };
  node.onfocus = () => {
    if (!touchClick) highlight(p.id);
  };
  node.onblur = () => {
    if (!state.touchPreview) resetImpact();
  };
  node.onclick = (event) => {
    if (touchClick && event.detail !== 0) {
      touchClick = false;
      if (state.touchPreview !== p.id) {
        state.previewOrigin = partOrigin(node);
        state.touchPreview = p.id;
        highlight(p.id);
        return;
      }
    }
    openDiff(p, partOrigin(node));
  };
}
// Balanced binary treemap. Split by cumulative pad count along the longer axis.
function pack(items, rect, visit, minSize = 0) {
  if (!items.length) return;
  if (items.length === 1) {
    visit(items[0], rect);
    return;
  }
  const total = items.reduce((s, p) => s + p.weight, 0);
  let sum = 0,
    cut = 0;
  while (
    cut < items.length - 1 &&
    (sum === 0 || sum + items[cut].weight <= total / 2)
  )
    sum += items[cut++].weight;
  const axis = rect.w >= rect.h ? rect.w : rect.h;
  const floor = Math.min(minSize, axis / 2);
  const ratio = Math.max(floor / axis, Math.min(1 - floor / axis, sum / total));
  if (rect.w >= rect.h) {
    pack(items.slice(0, cut), { ...rect, w: rect.w * ratio }, visit, minSize);
    pack(
      items.slice(cut),
      { ...rect, x: rect.x + rect.w * ratio, w: rect.w * (1 - ratio) },
      visit,
      minSize,
    );
  } else {
    pack(items.slice(0, cut), { ...rect, h: rect.h * ratio }, visit, minSize);
    pack(
      items.slice(cut),
      { ...rect, y: rect.y + rect.h * ratio, h: rect.h * (1 - ratio) },
      visit,
      minSize,
    );
  }
}
function position(node, r, gap = 2) {
  Object.assign(node.style, {
    left: `${r.x + gap}px`,
    top: `${r.y + gap}px`,
    width: `${Math.max(1, r.w - gap * 2)}px`,
    height: `${Math.max(1, r.h - gap * 2)}px`,
  });
}
function tile(p, r, parent) {
  const node = el(
    "button",
    undefined,
    `tile ${p.status}${isElectrical(p) ? " electrical" : ""}${changeGroup(p) === "Metadata" ? " metadata" : ""}`,
  );
  node.dataset.id = p.id;
  node.dataset.focusKey = `part:${p.id}`;
  position(node, r);
  node.setAttribute("aria-label", `${p.ref}, ${p.value}, ${p.status}`);
  node.title = `${p.ref} · ${p.value}\n${p.status} · ${Object.keys(p.pins).length} numbered pads\n${p.sheet}`;
  // Measure the whole reference in the loaded utility face. Never render a clipped ID.
  const available = r.w - 16;
  const measure = textMetrics;
  const family = getComputedStyle(document.documentElement).getPropertyValue(
    "--mono",
  );
  let fontSize = 12;
  for (; fontSize >= 9; fontSize--) {
    measure.font = `500 ${fontSize}px ${family}`;
    if (measure.measureText(p.ref).width <= available) break;
  }
  if (fontSize >= 9 && r.h - 14 >= fontSize * 1.4) {
    const label = el("span", p.ref, "ref");
    label.style.fontSize = `${fontSize}px`;
    node.append(label);
  }
  if (r.w > 65 && r.h > 48)
    node.append(el("span", p.value || p.footprint, "value"));
  if (r.w > 75 && r.h > 80)
    node.append(
      el(
        "span",
        `${Object.keys(p.pins).length} ${Object.keys(p.pins).length === 1 ? "pad" : "pads"}`,
        "pin-count",
      ),
    );
  wirePart(node, p);
  parent.append(node);
}
function renderMap() {
  buildMap();
  syncRoving($("tiles"), "map");
}
function buildMap() {
  $("map-scale-note").textContent =
    state.view === "board"
      ? "Footprint centers · markers not to scale"
      : "Area weighted by numbered pads, minimum 3 · grouped by board / sheet";
  const root = $("tiles");
  root.replaceChildren();
  $("connections").replaceChildren();
  const shown = report.parts.filter((p) => inScope(p) && matches(p));
  const removed = shown.filter((p) => p.status === "removed").length;
  $("scope-count").textContent =
    `${shown.length} in view${removed ? ` · ${removed} removed` : ""}`;
  $("scope-count").title =
    `${shown.length} components across both revisions, including ${removed} removed in head`;
  $("map-empty").hidden = shown.length > 0;
  const { width: w, height: h } = $("canvas").getBoundingClientRect();
  mapSize = `${w}:${h}`;
  if (!shown.length) return;
  if (state.view === "board") {
    renderBoard(shown, w, h);
    return;
  }
  const boardFiles = [...new Set(shown.map((p) => p.file))];
  const groupByBoard = !state.scope && boardFiles.length > 1;
  const groups = new Map();
  for (const p of shown) {
    const key = groupByBoard ? p.file : displaySheet(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  // At sheet depth, the entire available area belongs to the parts.
  if (state.scope?.sheet) {
    pack(
      shown
        .map((p) => ({ p, weight: weight(p) }))
        .sort((a, b) => b.weight - a.weight),
      { x: 4, y: 4, w: w - 8, h: h - 8 },
      (item, r) => tile(item.p, r, root),
    );
    return;
  }
  const items = [...groups]
    .map(([key, ps]) => ({
      key,
      ps,
      weight: ps.reduce((s, p) => s + weight(p), 0),
    }))
    .sort((a, b) => b.weight - a.weight);
  pack(
    items,
    { x: 3, y: 3, w: w - 6, h: h - 6 },
    (group, r) => {
      const node = el("div", undefined, "group");
      position(node, r, 3);
      const title = el("button", undefined, "group-title");
      title.dataset.focusKey = `group:${group.key}`;
      title.append(
        el(
          "span",
          groupByBoard
            ? shortFile(group.key)
            : group.key === "/"
              ? "Root sheet"
              : group.key,
        ),
        el(
          "small",
          `${group.ps.length} ${group.ps.length === 1 ? "part" : "parts"}`,
        ),
      );
      title.append(el("span", undefined, "chevron"));
      title.title = groupByBoard
        ? group.key
        : group.key === "/"
          ? "Root sheet"
          : group.key;
      title.setAttribute(
        "aria-label",
        `Open ${group.key === "/" ? "Root sheet" : group.key}`,
      );
      title.onclick = () =>
        setScope(
          groupByBoard
            ? { file: group.key }
            : { file: group.ps[0].file, sheet: group.key },
        );
      node.append(title);
      const inner = {
        x: 2,
        y: 30,
        w: Math.max(1, r.w - 10),
        h: Math.max(1, r.h - 38),
      };
      pack(
        group.ps
          .map((p) => ({ p, weight: weight(p) }))
          .sort((a, b) => b.weight - a.weight),
        inner,
        (item, box) => tile(item.p, box, node),
      );
      root.append(node);
    },
    w < 500 ? 140 : 90,
  );
}
function renderBoard(shown, w, h) {
  const files = [...new Set(shown.map((p) => p.file))];
  if (files.length > 1) {
    const chooser = el("div", undefined, "board-chooser");
    chooser.append(el("p", "Choose a board to view its physical layout."));
    for (const file of files) {
      const button = el("button", file);
      button.dataset.focusKey = `board:${file}`;
      button.onclick = () => setScope({ file });
      chooser.append(button);
    }
    $("tiles").append(chooser);
    return;
  }
  const xs = shown.map((p) => p.x),
    ys = shown.map((p) => p.y),
    minX = Math.min(...xs),
    minY = Math.min(...ys),
    maxX = Math.max(...xs),
    maxY = Math.max(...ys);
  const scale = Math.min(
    (w - 55) / Math.max(1, maxX - minX),
    (h - 55) / Math.max(1, maxY - minY),
  );
  const ox = (w - (maxX - minX) * scale) / 2,
    oy = (h - (maxY - minY) * scale) / 2;
  for (const p of shown) {
    const size = Math.min(36, Math.max(13, Math.sqrt(weight(p)) * 5));
    tile(
      p,
      {
        x: ox + (p.x - minX) * scale - size / 2,
        y: oy + (p.y - minY) * scale - size / 2,
        w: size,
        h: size,
      },
      $("tiles"),
    );
  }
  $("tiles").append(
    el(
      "span",
      "Footprint centers · not copper routing · not to scale",
      "board-note",
    ),
  );
}
function highlight(id) {
  state.hover = id;
  if (state.selected) return;
  const p = parts.get(id),
    result = reach(report, id, state),
    affected = new Set(result.ids);
  const root = $("canvas").getBoundingClientRect(),
    centers = new Map();
  for (const tile of $("tiles").querySelectorAll(".tile")) {
    const r = tile.getBoundingClientRect();
    centers.set(tile.dataset.id, {
      x: r.x - root.x + r.width / 2,
      y: r.y - root.y + r.height / 2,
      w: r.width,
      h: r.height,
    });
    tile.classList.toggle("hovered", tile.dataset.id === id);
    tile.classList.toggle("affected", affected.has(tile.dataset.id));
    tile.classList.toggle(
      "dimmed",
      tile.dataset.id !== id && !affected.has(tile.dataset.id),
    );
  }
  const svg = $("connections");
  svg.replaceChildren();
  const visibleEdges = result.edges.filter(
    (edge) => centers.has(edge.source) && centers.has(edge.target),
  );
  const dense = visibleEdges.length > 80;
  const edges = dense
    ? visibleEdges.filter(
        (edge) =>
          isElectrical(parts.get(edge.target)) ||
          (edge.source !== id && isElectrical(parts.get(edge.source))),
      )
    : visibleEdges;
  const borderPoint = (a, b) => {
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const scale = Math.min(
      a.w / 2 / (Math.abs(dx) || 1e-6),
      a.h / 2 / (Math.abs(dy) || 1e-6),
    );
    return { x: a.x + dx * scale, y: a.y + dy * scale };
  };
  for (const edge of edges) {
    const ca = centers.get(edge.source),
      cb = centers.get(edge.target);
    const a = borderPoint(ca, cb),
      b = borderPoint(cb, ca);
    const bend = Math.min(48, Math.abs(a.x - b.x) * 0.15);
    const d = `M ${a.x} ${a.y} C ${a.x} ${(a.y + b.y) / 2 - bend}, ${b.x} ${(a.y + b.y) / 2 - bend}, ${b.x} ${b.y}`;
    svg.append(
      svgEl("path", {
        d,
        fill: "none",
        stroke: "#6cb4ff",
        "stroke-width": edges.length > 30 ? 0.65 : 1,
        opacity: Math.max(
          0.12,
          Math.min(0.45, 3 / Math.sqrt(edges.length || 1)),
        ),
      }),
    );
  }
  const visible = result.ids.filter((id) => centers.has(id)).length;
  const title = `${p.ref} · ${result.ids.length} ${state.transitive ? `transitively reachable ${result.ids.length === 1 ? "part" : "parts"}` : `shared-net ${result.ids.length === 1 ? "neighbor" : "neighbors"}`}`;
  impact(
    title,
    `${p.status === "modified" ? `Changed: ${changeFields(p).join(", ")}. ` : `${p.status[0].toUpperCase() + p.status.slice(1)}. `}${result.nets.length} ${result.nets.length === 1 ? "net" : "nets"} · ${visible} highlighted in view · ${result.ids.length - visible} outside this view. ${dense ? `${edges.length} curves shown, only links involving electrical, added or removed neighbors. ` : `${edges.length} curves shown. `}${state.includeGround ? "Ground included." : "Ground excluded."} ${state.transitive ? "Structural reach, not signal propagation. " : ""}${result.nets.slice(0, 4).join(" · ")}${result.nets.length > 4 ? " …" : ""}`,
  );
  if (state.touchPreview === id) {
    const open = el("button", `Open ${p.ref} diff`, "open-preview");
    open.onclick = () => openDiff(p, state.previewOrigin);
    $("impact").append(open);
  }
}

function impact(title, text) {
  const box = $("impact");
  box.replaceChildren(el("span", undefined, "impact-dot"));
  const body = el("div");
  const heading = el("strong");
  const count = title.match(/^(.*? · )(\d+)( .*)$/);
  if (count)
    heading.append(count[1], el("span", count[2], "reach-count"), count[3]);
  else heading.textContent = title;
  body.append(heading, el("p", text));
  box.append(body);
}
function resetImpact() {
  state.touchPreview = null;
  state.hover = null;
  $("connections").replaceChildren();
  for (const tile of $("tiles").querySelectorAll(".tile"))
    tile.classList.remove("hovered", "affected", "dimmed");
  if (!state.selected)
    impact(
      "Trace electrical reach",
      "Hover or focus a component to highlight shared-net neighbors across both revisions. Tap to preview. Ground excluded by default.",
    );
}
function format(value) {
  if (value === undefined || value === null) return "∅";
  if (value === "") return '"" (empty string)';
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}
function assembly(value) {
  if (!Array.isArray(value)) return format(value);
  const labels = {
    smd: "SMD",
    through_hole: "Through-hole",
    exclude_from_bom: "Not in BOM",
    exclude_from_pos_files: "Not in position file",
    dnp: "DNP",
    board_only: "Board only",
    allow_missing_courtyard: "Allow missing courtyard",
    allow_soldermask_bridges: "Allow solder mask bridges",
  };
  return value.length
    ? value.map((flag) => labels[flag] ?? flag).join(", ")
    : "None";
}
function setChangesExpanded(expanded) {
  $("toggle-changes").setAttribute("aria-expanded", expanded);
  $("toggle-changes").textContent = expanded ? "Hide changes" : "Show changes";
  document.querySelector("aside").classList.toggle("expanded", expanded);
}
function openDiff(p, origin) {
  state.inspectOrigin = origin ?? { region: "map", key: `part:${p.id}` };
  state.selected = p.id;
  if (matchMedia("(max-width: 700px)").matches) setChangesExpanded(false);
  resetImpact();
  renderList();
  $("map-panel").hidden = true;
  const panel = $("diff-panel");
  panel.hidden = false;
  panel.replaceChildren();
  const head = el("div", undefined, "diff-header"),
    title = el("h2", p.ref);
  title.append(el("small", p.status));
  const close = el("button", "← Back to map", "close-diff");
  close.onclick = closeDiff;
  head.append(title, close);
  panel.append(
    head,
    el(
      "p",
      `${p.file} · ${p.sheet} · ${p.value || p.footprint}`,
      "diff-subtitle",
    ),
  );
  const pinCount = changedPins(p).length,
    padCount = changedPadNumbers(p).size;
  panel.append(
    el(
      "p",
      p.status === "modified"
        ? `${pinCount ? `${pinCount} ${pinCount === 1 ? "pin rewired" : "pins rewired"}. ` : ""}${orderedChanges(
            p,
          )
            .filter((c) => c.field !== "pins")
            .map(
              (c) =>
                (propertyPriority(c)
                  ? propertyPriority(c)[0].toUpperCase() +
                    propertyPriority(c).slice(1)
                  : null) ??
                {
                  attributes: "Assembly",
                  pads: "Pad geometry",
                  fields: "Properties",
                  x: "X position",
                  y: "Y position",
                  angle: "Rotation",
                }[c.field] ??
                c.field[0].toUpperCase() + c.field.slice(1),
            )
            .join(
              ", ",
            )}${p.changes.some((c) => c.field !== "pins") ? " changed. " : ""}${padCount} ${padCount === 1 ? "pad change" : "pad changes"} highlighted.`
        : p.status === "unchanged"
          ? "No semantic changes in this component."
          : `${p.status === "added" ? "Added in head" : "Removed from head"}. All present pads highlighted.`,
      "diff-summary",
    ),
  );
  const context = el("dl", undefined, "swap-context");
  for (const c of orderedChanges(p)) {
    if (!["value", "footprint"].includes(c.field)) continue;
    context.append(
      el("dt", c.field === "value" ? "Value" : "Footprint"),
      el("dd", `${format(c.before)} → ${format(c.after)}`),
    );
  }
  if (context.children.length) panel.append(context);
  const regions = el("div", undefined, "regions");
  const extent =
    Math.max(
      3,
      ...[p.before, p.after].filter(Boolean).flatMap((part) =>
        part.pads.map((pad) => {
          const pos = padPosition(part, pad),
            angle = (pad.angle * Math.PI) / 180;
          const rx =
            (Math.abs(pad.w * Math.cos(angle)) +
              Math.abs(pad.h * Math.sin(angle))) /
            2;
          const ry =
            (Math.abs(pad.w * Math.sin(angle)) +
              Math.abs(pad.h * Math.cos(angle))) /
            2;
          return Math.max(Math.abs(pos.x) + rx, Math.abs(pos.y) + ry);
        }),
      ),
    ) * 1.25;
  for (const key of ["before", "after"]) {
    const figure = el("figure", undefined, "region");
    figure.append(
      el(
        "figcaption",
        `${key === "before" ? "Base" : "Head"} · ${(extent * 2).toFixed(1)} × ${(extent * 2).toFixed(1)} mm`,
      ),
    );
    figure.append(regionSvg(p, key, extent));
    regions.append(figure);
  }
  panel.append(
    regions,
    el(
      "p",
      "Local pad regions · nonstandard pad shapes approximate",
      "region-note",
    ),
  );
  const table = el("table", undefined, "semantic"),
    tr = el("tr");
  for (const name of ["Field / pin", "Base", "Head"]) tr.append(el("th", name));
  table.append(tr);
  const geometryTable = table.cloneNode(true);
  const row = (field, a, b, target = table) => {
    const tr = el("tr");
    tr.append(el("td", field));
    for (const value of [a, b]) {
      const td = el("td");
      td.append(el("code", format(value)));
      tr.append(td);
    }
    target.append(tr);
  };
  const changes = orderedChanges(p);
  if (p.before && p.after) {
    for (const c of changes) {
      if (c.field === "pins") {
        for (const pin of [
          ...new Set([...Object.keys(c.before), ...Object.keys(c.after)]),
        ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
          if (JSON.stringify(c.before[pin]) !== JSON.stringify(c.after[pin]))
            row(
              `Pin ${pin}`,
              c.before[pin]?.join(", "),
              c.after[pin]?.join(", "),
            );
        }
      } else if (c.field === "pads") {
        const a = padGroups(c.before),
          b = padGroups(c.after);
        const describe = (pads) =>
          pads
            ?.map(
              (pad) =>
                `${pad.type} ${pad.shape}; ${pad.w} × ${pad.h} mm; at ${pad.x}, ${pad.y}; ${pad.angle}°; drill ${JSON.stringify(pad.drill)}; layers ${pad.layers.join(", ")}${pad.geometry.length ? `; shape ${JSON.stringify(pad.geometry)}` : ""}`,
            )
            .join("\n");
        for (const number of [...new Set([...a.keys(), ...b.keys()])].sort(
          (a, b) => a.localeCompare(b, undefined, { numeric: true }),
        )) {
          if (JSON.stringify(a.get(number)) !== JSON.stringify(b.get(number)))
            row(
              `Pad ${number || "mechanical"} local geometry`,
              describe(a.get(number)),
              describe(b.get(number)),
              geometryTable,
            );
        }
      } else if (c.field === "fields") {
        for (const key of [
          ...new Set([...Object.keys(c.before), ...Object.keys(c.after)]),
        ].sort())
          if (JSON.stringify(c.before[key]) !== JSON.stringify(c.after[key]))
            row(`Property: ${key}`, c.before[key], c.after[key]);
      } else
        row(
          {
            value: "Value",
            footprint: "Footprint",
            side: "Board side",
            sheet: "Sheet",
            x: "X position, mm",
            y: "Y position, mm",
            angle: "Rotation, °",
            attributes: "Assembly",
            fields: "Properties",
          }[c.field] ?? c.field,
          c.field === "attributes" ? assembly(c.before) : c.before,
          c.field === "attributes" ? assembly(c.after) : c.after,
        );
    }
    if (!changes.length)
      row("Component", "No semantic changes", "No semantic changes");
  } else {
    for (const pin of Object.keys(p.pins).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    ))
      row(
        `Pin ${pin}`,
        p.before?.pins[pin]?.join(", "),
        p.after?.pins[pin]?.join(", "),
      );
    for (const key of ["value", "footprint", "sheet", "side"])
      row(key[0].toUpperCase() + key.slice(1), p.before?.[key], p.after?.[key]);
    row(
      "Assembly",
      assembly(p.before?.attributes),
      assembly(p.after?.attributes),
    );
    for (const key of Object.keys((p.after ?? p.before).fields).sort())
      row(`Property: ${key}`, p.before?.fields[key], p.after?.fields[key]);
  }
  panel.append(table);
  if (geometryTable.rows.length > 1) {
    const details = el("details", undefined, "geometry-details");
    details.append(
      el(
        "summary",
        `Changed pad geometry · ${geometryTable.rows.length - 1} ${geometryTable.rows.length === 2 ? "pad" : "pads"}`,
      ),
      geometryTable,
    );
    panel.append(details);
  }
  panel.scrollTop = 0;
  inspectorImpact(p);
  close.focus({ preventScroll: true });
  if (matchMedia("(max-width: 700px)").matches)
    window.scrollTo({ top: 0, behavior: "instant" });
}
function inspectorImpact(p) {
  const count = reach(report, p.id, state).ids.length;
  impact(
    `${p.ref} · ${count} ${state.transitive ? "transitively reachable" : "connected"} ${count === 1 ? "part" : "parts"}`,
    `Pad geometry, connectivity and footprint properties, compared across base and head. White pads are unchanged; red and green pads changed. ${state.includeGround ? "Ground included." : "Ground excluded."}`,
  );
}
function closeDiff() {
  state.selected = null;
  renderList();
  $("diff-panel").hidden = true;
  $("map-panel").hidden = false;
  renderMap();
  resetImpact();
  const origin = state.inspectOrigin;
  const mobile = matchMedia("(max-width: 700px)").matches;
  const root =
    origin?.region === "list" && !mobile ? $("part-list") : $("tiles");
  const target = [...root.querySelectorAll("button")].find(
    (n) => n.dataset.focusKey === origin?.key,
  );
  (target ?? $("map-tab")).focus({ preventScroll: mobile });
  if (mobile) $("canvas").scrollIntoView({ block: "nearest" });
}
function padPosition(part, pad) {
  const angle = (part.angle * Math.PI) / 180;
  return {
    x: pad.x * Math.cos(angle) + pad.y * Math.sin(angle),
    y: -pad.x * Math.sin(angle) + pad.y * Math.cos(angle),
  };
}
function regionSvg(selected, key, extent) {
  const svg = svgEl("svg", {
    viewBox: `${-extent} ${-extent} ${extent * 2} ${extent * 2}`,
    role: "img",
    "aria-label": `${key} pad region for ${selected.ref}`,
  });
  const anchor = selected[key];
  const changed = changedPadNumbers(selected);
  const mechanical = changedMechanicalPads(selected, key);
  const regionHeight = matchMedia("(max-width: 700px)").matches ? 140 : 180;
  if (!anchor) {
    const label = svgEl("text", {
      "text-anchor": "middle",
      fill: "#8a9da9",
      "font-size": extent / 6,
    });
    label.textContent =
      key === "before" ? "Not present in base" : "Removed in head";
    svg.append(label);
    return svg;
  }
  const annotations = [];
  for (const p of report.parts) {
    const part = p[key];
    if (!part || part.file !== anchor.file) continue;
    const dx = part.x - anchor.x,
      dy = part.y - anchor.y;
    if (Math.abs(dx) > extent * 2 || Math.abs(dy) > extent * 2) continue;
    for (const pad of part.pads) {
      const pos = padPosition(part, pad),
        x = dx + pos.x,
        y = dy + pos.y;
      const edited =
        p.id === selected.id &&
        (pad.number ? changed.has(pad.number) : mechanical.has(pad));
      const color =
        p.id === selected.id
          ? edited
            ? key === "before"
              ? "#f0708a"
              : "#3ecf98"
            : "#d6dfe5"
          : "#36414a";
      const rect = svgEl("rect", {
        x: x - pad.w / 2,
        y: y - pad.h / 2,
        width: pad.w,
        height: pad.h,
        rx: ["circle", "oval"].includes(pad.shape)
          ? Math.min(pad.w, pad.h) / 2
          : pad.shape === "roundrect"
            ? Math.min(pad.w, pad.h) *
              Number(
                pad.geometry.find((n) => n[0] === "roundrect_rratio")?.[1] ??
                  0.25,
              )
            : 0,
        fill: color,
        "data-pad": pad.number,
        "data-selected": p.id === selected.id,
        "data-changed": edited,
        opacity: p.id === selected.id ? 0.9 : 0.4,
        transform: `rotate(${-pad.angle} ${x} ${y})`,
      });
      const padTitle = svgEl("title");
      padTitle.textContent = `${p.ref} · pad ${pad.number || "mechanical"}${edited ? " · changed" : ""}`;
      rect.append(padTitle);
      svg.append(rect);
      if (pad.drill?.length) {
        const oval = pad.drill[0] === "oval",
          dw = Number(pad.drill[oval ? 1 : 0]),
          dh = oval ? Number(pad.drill[2]) : dw;
        const offset =
          pad.drill.find((n) => Array.isArray(n) && n[0] === "offset") ?? [];
        if (dw > 0 && dh > 0) {
          const hole = svgEl("rect", {
            x: x - dw / 2 + Number(offset[1] ?? 0),
            y: y - dh / 2 + Number(offset[2] ?? 0),
            width: dw,
            height: dh,
            rx: Math.min(dw, dh) / 2,
            fill: "#0a0d10",
            stroke: color,
            "stroke-width": 0.08,
            transform: `rotate(${-pad.angle} ${x} ${y})`,
            "data-drill": pad.number,
          });
          svg.append(hole);
        }
      }
      const labelSize = (extent * 2 * 11) / regionHeight;
      if (
        p.id === selected.id &&
        pad.number &&
        labelSize <= pad.h * 0.8 &&
        labelSize * pad.number.length * 0.65 <= pad.w * 0.8
      ) {
        const text = svgEl("text", {
          x,
          y: y + labelSize * 0.35,
          "text-anchor": "middle",
          fill: "#0d171e",
          "font-size": labelSize,
        });
        text.textContent = pad.number;
        svg.append(text);
      }
    }
    if (p.id !== selected.id) {
      const fontSize = (extent * 2 * 11) / regionHeight;
      const width = p.ref.length * fontSize * 0.65,
        height = fontSize * 1.3;
      const box = {
        x: dx - width / 2,
        y: dy - 1 - height,
        w: width,
        h: height,
      };
      // Keep contextual IDs whole, outside the selected pad region and apart from each other.
      const outsideSelected =
        Math.abs(dx) > extent * 0.75 || Math.abs(dy) > extent * 0.75;
      const fits =
        box.x >= -extent &&
        box.y >= -extent &&
        box.x + box.w <= extent &&
        box.y + box.h <= extent;
      const overlaps = annotations.some(
        (r) =>
          box.x < r.x + r.w &&
          box.x + box.w > r.x &&
          box.y < r.y + r.h &&
          box.y + box.h > r.y,
      );
      if (outsideSelected && fits && !overlaps) {
        const label = svgEl("text", {
          x: dx,
          y: dy - 1,
          fill: "#6f7c86",
          "font-size": fontSize,
          "text-anchor": "middle",
        });
        label.textContent = p.ref;
        svg.append(label);
        annotations.push(box);
      }
    }
  }
  return svg;
}
async function init() {
  try {
    const response = await fetch("/api/report");
    if (!response.ok)
      throw new Error(`Report request returned ${response.status}`);
    report = await response.json();
    await document.fonts.load('12px "Boardmap Mono"');
    parts = new Map(report.parts.map((p) => [p.id, p]));
    $("revision").textContent =
      `${report.base.slice(0, 8)} → ${report.head.slice(0, 8)}`;
    $("project").textContent =
      report.boards.length === 1
        ? report.boards[0]
        : `${report.boards.length} boards · ${report.boards.map(shortFile).join(" / ")}`;
    $("project").title = report.boards.join("\n");
    $("change-count").textContent = report.stats.changed;
    if (report.sheetRenames?.length) {
      const details = el("details", undefined, "sheet-renames");
      details.append(
        el("summary", `${report.sheetRenames.length} sheet labels renamed`),
      );
      const list = el("ul");
      for (const rename of report.sheetRenames)
        list.append(el("li", `${rename.before} → ${rename.after}`));
      details.append(list);
      $("project").after(details);
    }
    for (const [key, label] of [
      ["parts", "parts"],
      ["nets", "nets"],
      ["electrical", "electrical"],
      ["changed", "changed"],
      ["affected", "affected"],
    ]) {
      const box = el("div", undefined, key);
      box.append(
        el(
          "strong",
          key === "electrical"
            ? report.parts.filter(isElectrical).length
            : report.stats[key],
        ),
        el("span", label),
      );
      box.title =
        key === "affected"
          ? "Unchanged direct shared-net neighbors of changed parts, excluding ground, across both revisions."
          : key === "electrical"
            ? "Pin nets, pads, value, footprint, population or part identifier changes, plus added and removed parts with pads. Zero-pad artwork is metadata."
            : key === "parts"
              ? "Parts in head; removed parts remain visible in the map."
              : "";
      $("stats").append(box);
    }
    $("selection").textContent =
      `${report.boards.length} of ${report.availableBoards.length} ${report.availableBoards.length === 1 ? "board" : "boards"} selected${report.selection === "changed boards" ? " · changed boards" : ""}`;
    $("toggle-changes").onclick = () => {
      const expanded =
        $("toggle-changes").getAttribute("aria-expanded") !== "true";
      setChangesExpanded(expanded);
    };
    $("search").oninput = (e) => {
      state.query = e.target.value.trim().toLowerCase();
      renderList();
      if (!state.selected) {
        renderMap();
        resetImpact();
      }
    };
    $("only-changed").onchange = renderList;
    $("reach").onchange = (e) => {
      state.transitive = e.target.value === "transitive";
      if (state.selected) inspectorImpact(parts.get(state.selected));
      else if (state.hover) highlight(state.hover);
    };
    $("ground").onchange = (e) => {
      state.includeGround = e.target.checked;
      if (state.selected) inspectorImpact(parts.get(state.selected));
      else if (state.hover) highlight(state.hover);
    };
    for (const [id, view] of [
      ["map-tab", "map"],
      ["board-tab", "board"],
    ])
      $(id).onclick = () => {
        state.view = view;
        $(id).classList.add("active");
        $(id).setAttribute("aria-pressed", "true");
        $(id === "map-tab" ? "board-tab" : "map-tab").setAttribute(
          "aria-pressed",
          "false",
        );
        $(id === "map-tab" ? "board-tab" : "map-tab").classList.remove(
          "active",
        );
        if (state.selected) closeDiff();
        renderMap();
        resetImpact();
      };
    wireRoving($("part-list"), "list");
    wireRoving($("tiles"), "map");
    // Reset only after leaving the canvas, not when crossing tile gutters.
    $("canvas").addEventListener("pointerleave", (event) => {
      if (event.pointerType !== "touch" && !state.touchPreview) {
        const focused = document.activeElement;
        if ($("tiles").contains(focused) && focused.dataset.id)
          highlight(focused.dataset.id);
        else resetImpact();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (state.selected) closeDiff();
      else resetImpact();
    });
    document.addEventListener("pointerdown", (event) => {
      if (
        event.pointerType === "touch" &&
        state.touchPreview &&
        !event.target.closest(".tile, .part-row, .open-preview")
      )
        resetImpact();
    });
    resize = new ResizeObserver(() => {
      const box = $("canvas").getBoundingClientRect(),
        size = `${box.width}:${box.height}`;
      if (
        !state.selected &&
        box.width > 0 &&
        box.height > 0 &&
        size !== mapSize
      ) {
        const active = document.activeElement;
        const focusKey = $("tiles").contains(active)
          ? active.dataset.focusKey
          : null;
        mapSize = size;
        renderMap();
        if (state.hover) highlight(state.hover);
        else resetImpact();
        if (focusKey)
          [...$("tiles").querySelectorAll("button")]
            .find((button) => button.dataset.focusKey === focusKey)
            ?.focus();
      }
    });
    resize.observe($("canvas"));
    breadcrumb();
    renderList();
    renderMap();
    resetImpact();
  } catch (error) {
    $("project").textContent =
      `Could not load this review. ${error.message}. Restart boardmap and reload this page.`;
  }
}
init();
