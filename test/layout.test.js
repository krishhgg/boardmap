import test from "node:test";
import assert from "node:assert/strict";
import { pack, sheetHeight } from "../web/layout.js";
const minimumSide = (items, width, height) => {
  let side = Infinity;
  pack(items, { x: 4, y: 4, w: width - 8, h: height - 8 }, (_, rect) => {
    side = Math.min(side, rect.w - 4, rect.h - 4);
  });
  return side;
};
test("a dense drilled phone sheet grows to finger-sized targets", () => {
  const items = [144, 100, 26, 22, ...Array(132).fill(3)].map((weight) => ({ weight }));
  for (const width of [304, 374, 684]) {
    const height = sheetHeight(items, width);
    assert.ok(height > 380);
    assert.ok(minimumSide(items, width, height) >= 32);
  }
});
test("small sheets keep the ordinary map height", () => {
  assert.equal(sheetHeight([{ weight: 144 }], 374), 380);
  assert.equal(sheetHeight([], 374), 380);
});
test("a large IC and one resistor do not trigger a column-sized sheet", () => {
  const items = [100, 3].map((weight) => ({ weight }));
  const height = sheetHeight(items, 374);
  assert.ok(height < 2000, `two parts should not need ${height}px`);
  assert.ok(minimumSide(items, 374, height) >= 32);
});
test("desktop sheets keep their viewport floor and grow for reference fit", () => {
  const fits = (_, rect) => rect.w >= 80 && rect.h >= 25;
  const small = [3, 3].map((weight) => ({ weight }));
  assert.equal(sheetHeight(small, 374, { minHeight: 455, minSide: 0, fits }), 455);
  const uneven = [100, 3].map((weight) => ({ weight }));
  const height = sheetHeight(uneven, 374, { minHeight: 455, minSide: 0, fits });
  assert.ok(height > 455);
  pack(uneven, { x: 4, y: 4, w: 366, h: height - 8 }, (item, rect) => {
    assert.ok(fits(item, rect));
  });
});
test("uneven pad counts still preserve every touch target", () => {
  const items = [3000, ...Array(19).fill(3)].map((weight) => ({ weight }));
  const height = sheetHeight(items, 374);
  assert.ok(minimumSide(items, 374, height) >= 32);
});
