// Balanced binary treemap. Split by cumulative pad count along the longer axis.
export function pack(items, rect, visit, minSize = 0) {
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
// Grow a drilled sheet until its hit targets and reference labels fit.
export function sheetHeight(
  items,
  width,
  { minHeight = 380, minSide = 32, fits = () => true } = {},
) {
  const usableWidth = Math.max(1, width - 8);
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  const smallest = Math.min(...items.map((item) => item.weight));
  let height = Math.max(
    minHeight,
    Math.ceil(total / smallest * (minSide + 8) ** 2 / usableWidth) + 8,
  );
  // A column bounds growth even for an unusually uneven pin distribution.
  const limit = Math.max(height, Math.ceil(total / smallest * usableWidth) + 8);
  for (;;) {
    let allFit = true;
    pack(items, { x: 4, y: 4, w: usableWidth, h: height - 8 }, (item, rect) => {
      if (Math.min(rect.w - 4, rect.h - 4) < minSide || !fits(item, rect))
        allFit = false;
    });
    if (allFit || height >= limit) return height;
    height = Math.min(limit, Math.ceil(height * 1.2));
  }
}
