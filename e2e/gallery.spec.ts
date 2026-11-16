import { expect, type Page, test } from "@playwright/test";

const album = "/albums/demo-match";

// The demo album is two 3:2 photos and a 16:9 video poster. At this width the
// photos share the first row and the video is alone on the last one.
const lastRowViewport = { width: 900, height: 800 };

async function rowHeights(page: Page) {
  return page.locator(".photo-grid figure img").evaluateAll((images) => {
    const rows = new Map<number, number[]>();
    for (const image of images) {
      const top = (image.closest("figure") as HTMLElement).offsetTop;
      rows.set(top, [
        ...(rows.get(top) ?? []),
        image.getBoundingClientRect().height,
      ]);
    }
    return [...rows.entries()].sort(([a], [b]) => a - b).map(([, h]) => h);
  });
}

test("last row matches the height of the row above", async ({ page }) => {
  await page.setViewportSize(lastRowViewport);
  await page.goto(album);
  // balanceLastRow sets an inline width on last-row figures; wait for it.
  await expect(page.locator(".photo-grid figure").last()).toHaveAttribute(
    "style",
    /width/,
  );
  const rows = await rowHeights(page);
  expect(rows, "fixture should end with a lone row").toHaveLength(2);
  expect(rows[0]).toHaveLength(2);
  expect(rows[1]).toHaveLength(1);
  expect(rows[1]?.[0]).toBeCloseTo(rows[0]?.[0] ?? 0, 0);
});

test("mobile is a single column and does not rescale the last row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(album);
  const figures = page.locator(".photo-grid figure");
  await expect(figures).toHaveCount(3);
  const lefts = await figures.evaluateAll((all) =>
    all.map((figure) => figure.getBoundingClientRect().left),
  );
  expect(new Set(lefts).size).toBe(1);
  await expect(figures.last()).not.toHaveAttribute("style", /width/);
});

test("viewer opens, steps with arrow keys and closes with Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(album);
  const links = page.locator(".photo-link");
  const ids = await links.evaluateAll((all) =>
    all.map((link) => (link as HTMLElement).dataset.photoId),
  );
  const viewer = page.locator("#viewer");
  const image = page.locator("#viewer-image");
  const where = page.locator("#viewer-position");

  await links.first().click();
  await expect(viewer).toBeVisible();
  await expect(where).toHaveText("1 / 3");
  await expect(page).toHaveURL(new RegExp(`photo=${ids[0]}$`));
  // The viewer should use most of the window rather than a narrow column.
  await expect(image).toHaveJSProperty("complete", true);
  const box = await image.boundingBox();
  expect(box?.width).toBeGreaterThan(1280 * 0.6);

  await page.keyboard.press("ArrowRight");
  await expect(where).toHaveText("2 / 3");
  await expect(page).toHaveURL(new RegExp(`photo=${ids[1]}$`));

  await page.keyboard.press("ArrowLeft");
  await expect(where).toHaveText("1 / 3");
  await expect(page).toHaveURL(new RegExp(`photo=${ids[0]}$`));

  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(page).not.toHaveURL(/photo=/);
});

test("opening a photo prefetches its neighbour", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "image") requested.push(request.url());
  });
  await page.goto(album);
  const second = await page
    .locator(".photo-link")
    .nth(1)
    .evaluate((link) => (link as HTMLElement).dataset.viewer ?? "");
  expect(second).toContain("/viewer");
  expect(requested.some((url) => url.endsWith(second))).toBe(false);

  await page.locator(".photo-link").first().click();
  await expect
    .poll(() => requested.some((url) => url.endsWith(second)))
    .toBe(true);
});

test("browsing produces no console errors, CSP violations or failed requests", async ({
  page,
}) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      problems.push(`console ${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400)
      problems.push(`${response.status()} ${response.url()}`);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) =>
      console.error(`CSP violation: ${event.violatedDirective}`),
    );
  });

  await page.goto(album);
  await page.locator(".photo-link").first().click();
  const where = page.locator("#viewer-position");
  await expect(where).toHaveText("1 / 3");
  await page.keyboard.press("ArrowRight");
  await expect(where).toHaveText("2 / 3");
  await page.keyboard.press("Escape");
  await expect(page.locator("#viewer")).toBeHidden();
  await page.waitForLoadState("networkidle");

  expect(problems).toEqual([]);
});
