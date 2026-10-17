import { expect, test } from "@playwright/test";

test("Monos directory uses the live rail components at desktop and minimum widths", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/tests/browser/monos-sidebar.html");
  await page.getByRole("button", { name: "Monos" }).click();

  const directory = page.locator('[data-mono-presentation="directory"]');
  const longRow = directory.locator('button[aria-current="true"]');
  await expect(directory).toBeVisible();
  await expect(longRow).toHaveAttribute("aria-current", "true");
  await expect(longRow.locator("span.break-all")).toHaveCSS(
    "font-size",
    "15px",
  );
  expect((await longRow.boundingBox())?.height).toBeGreaterThanOrEqual(56);
  await page.screenshot({
    path: testInfo.outputPath("monos-directory-dark-desktop.png"),
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Toggle theme" }).click();
  await page.screenshot({
    path: testInfo.outputPath("monos-directory-light-desktop.png"),
    animations: "disabled",
  });

  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await page.setViewportSize({ width: 760, height: 820 });
  await expect(longRow).toBeVisible();
  expect((await longRow.boundingBox())?.height).toBeGreaterThanOrEqual(56);
  await page.screenshot({
    path: testInfo.outputPath("monos-directory-light-200-percent.png"),
    animations: "disabled",
  });
});

test("Monos is keyboard-selectable and reachable from the collapsed rail without a route reset", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/monos-sidebar.html");
  await page.getByRole("button", { name: "Collapse rail" }).click();
  const monosRoute = page.getByRole("button", { name: "Show Monos" });
  await expect(monosRoute).toBeVisible();
  await monosRoute.click();

  const longRow = page.locator(
    '[data-mono-presentation="directory"] button[aria-current="true"]',
  );
  await longRow.focus();
  await expect(longRow).toBeFocused();
  await longRow.press("Enter");
  await expect(page.locator("[data-fixture-destination]")).toHaveText(
    "Mono conversation",
  );
  await expect(longRow).toHaveCSS("transition-duration", "0s");
  await page.screenshot({
    path: testInfo.outputPath("monos-directory-reduced-motion.png"),
    animations: "disabled",
  });
});
