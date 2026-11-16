import { expect, type Page, test } from "@playwright/test";

// A synthetic grid with the usual mix of 3:2, 16:9 and 4:5 photos, served at a
// path the demo does not handle, using the demo's real style.css and gallery.js.
// Images are blank SVGs of the right proportions.
const fixture = "/layout-fixture";
const sizes = [
  [3072, 2048],
  [3072, 2048],
  [3072, 1728],
  [2458, 3072],
  [3072, 2048],
  [3072, 1728],
  [3072, 1728],
  [3072, 2048],
  [2458, 3072],
  [3072, 2048],
];
const figures = Array.from({ length: 31 }, (_, i) => {
  const [width, height] = sizes[i % sizes.length] as [number, number];
  const bucket = Math.min(30, Math.max(4, Math.round((width / height) * 10)));
  const svg = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`)}`;
  return `<figure class="ar-${bucket}"><a class="photo-link" href="#"><img src="${svg}" width="${width}" height="${height}" alt=""></a></figure>`;
}).join("");
const html = `<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head>
<body><main><div class="photo-grid">${figures}</div></main>
<script src="/gallery.js" defer></script></body></html>`;

async function open(page: Page, width: number) {
  await page.route(`**${fixture}`, (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.setViewportSize({ width, height: 900 });
  await page.goto(fixture);
  await expect(page.locator(".photo-grid figure").last()).toHaveAttribute(
    "style",
    /width/,
  );
}

async function measure(page: Page) {
  return page.locator(".photo-grid").evaluate((grid) => {
    const rows = new Map<number, DOMRect[]>();
    for (const figure of grid.querySelectorAll("figure")) {
      const top = (figure as HTMLElement).offsetTop;
      const box = (
        figure.querySelector("img") as HTMLElement
      ).getBoundingClientRect();
      rows.set(top, [...(rows.get(top) ?? []), box]);
    }
    const left = grid.getBoundingClientRect().left;
    return {
      width: grid.clientWidth,
      target: parseFloat(getComputedStyle(grid).getPropertyValue("--row")),
      rows: [...rows.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, boxes]) => ({
          heights: boxes.map((box) => box.height),
          right: Math.max(...boxes.map((box) => box.right)) - left,
        })),
    };
  });
}

for (const width of [1440, 1100, 800, 700]) {
  test(`mixed aspect ratios form even, full rows at ${width}px`, async ({
    page,
  }) => {
    await open(page, width);
    const grid = await measure(page);
    expect(grid.target).toBeGreaterThan(0);
    expect(grid.rows.length).toBeGreaterThan(2);
    const last = grid.rows.length - 1;
    grid.rows.forEach((row, index) => {
      const height = row.heights[0] ?? 0;
      // One height per row; the grid images round to whole pixels, so allow 1px.
      for (const other of row.heights)
        expect(Math.abs(other - height)).toBeLessThanOrEqual(1);
      if (index === last) {
        const previous = grid.rows[index - 1]?.heights[0] ?? 0;
        expect(height).toBeLessThanOrEqual(previous + 1);
        return;
      }
      // Rows fill the width and stay near the target: a 16:9 photo is never
      // left alone on a row twice as tall as its neighbours.
      expect(row.right).toBeGreaterThan(grid.width - 3);
      expect(row.right).toBeLessThanOrEqual(grid.width + 0.5);
      expect(height / grid.target).toBeGreaterThan(0.7);
      expect(height / grid.target).toBeLessThan(1.4);
    });
  });
}

test("layout follows the viewport across the mobile breakpoint", async ({
  page,
}) => {
  await open(page, 1100);
  const wide = await measure(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const figures = page.locator(".photo-grid figure");
  await expect(figures.first()).not.toHaveAttribute("style", /width/);
  const lefts = await figures.evaluateAll((all) =>
    all.map((figure) => figure.getBoundingClientRect().left),
  );
  expect(new Set(lefts).size).toBe(1);

  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(figures.first()).toHaveAttribute("style", /width/);
  await expect
    .poll(async () => (await measure(page)).rows.length)
    .toBe(wide.rows.length);
});
