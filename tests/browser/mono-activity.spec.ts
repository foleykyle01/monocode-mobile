import { expect, test } from "@playwright/test";

test("an inactive Mono follows child activity and respects reduced motion", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/mono-overview.html?activity");
  const inactive = page.locator(
    "[data-mono-rail] [data-mono-status]:not([data-selected])",
  );
  await expect(inactive).toHaveAttribute("data-mono-status", "idle");
  await page.getByRole("button", { name: "Start child", exact: true }).click();
  await expect(inactive).toHaveAttribute("data-mono-status", "working");
  await expect(inactive.getByRole("button", { name: /Working/ })).toBeVisible();
  const dot = inactive.locator("[data-mono-status-dot]");
  await expect(dot).toHaveCSS("animation-name", "none");
  await page
    .getByRole("button", { name: "Child needs input", exact: true })
    .click();
  await expect(inactive).toHaveAttribute("data-mono-status", "needs-you");
  await expect(
    inactive.getByRole("button", { name: /Needs you/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Finish child", exact: true }).click();
  await expect(inactive).toHaveAttribute("data-mono-status", "idle");
  await expect(dot).toHaveAttribute("data-mono-status-dot", "done");
  await expect(dot).toHaveAccessibleName("Done, 1 new reply");
  await expect(dot).toHaveText("");
  await expect(dot).toHaveCSS("width", "8px");
  await expect(dot).toHaveCSS("height", "8px");
  await expect(inactive.locator("[data-mono-unread][data-mono-status-dot]")).toHaveCount(1);
  const rowBox = (await inactive.boundingBox())!;
  const dotBox = (await dot.boundingBox())!;
  expect(rowBox.x + rowBox.width - dotBox.x - dotBox.width / 2).toBeCloseTo(12);
  expect(dotBox.y + dotBox.height / 2).toBeCloseTo(rowBox.y + rowBox.height / 2);
  await inactive.hover();
  const menu = inactive.getByRole("button", { name: /options/ });
  await expect(menu).toBeVisible();
  const menuBox = (await menu.boundingBox())!;
  const hoveredDotBox = (await dot.boundingBox())!;
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(hoveredDotBox.x);
  expect(hoveredDotBox.x).toBeCloseTo(dotBox.x);
  await expect(dot).toBeVisible();
  await page.mouse.move(800, 700);
  await expect(inactive.locator("[data-mono-unread]")).toBeVisible();
  await inactive.screenshot({ path: testInfo.outputPath("mono-done.png") });
  await inactive.getByRole("button", { name: /Done, unread/ }).click();
  await expect(dot).toHaveAttribute("data-mono-status-dot", "idle");
  await expect(inactive.locator("[data-mono-unread]")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Another Mono is open" }),
  ).toBeVisible();
});
