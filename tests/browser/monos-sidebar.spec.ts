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
  await expect(
    page.getByRole("button", { name: "Project options", exact: true }),
  ).toHaveCount(0);
  await expect(longRow).toHaveAttribute("aria-current", "true");
  await expect(longRow.locator("span.break-all")).toHaveCSS(
    "font-size",
    "15px",
  );
  const activeProject = directory.locator("[data-mono-project-scope]").first();
  await expect(activeProject).toHaveAttribute(
    "data-mono-project-status",
    "working",
  );
  await expect(activeProject).toHaveAccessibleName(
    /Working.*VeryLongUnbrokenProjectNameThatMustRemainReadableAtTheMinimumRailWidth/,
  );
  await expect(activeProject).toHaveAttribute(
    "title",
    "/fixture/VeryLongUnbrokenProjectNameThatMustRemainReadableAtTheMinimumRailWidth",
  );
  await expect(activeProject.locator("button")).toHaveCount(0);
  await expect(activeProject.locator("span.break-all")).toHaveCSS(
    "font-size",
    "13px",
  );
  expect((await longRow.boundingBox())?.height).toBeGreaterThanOrEqual(56);

  const options = longRow
    .locator("..")
    .getByRole("button", { name: /options$/ });
  await expect(options).toBeVisible();
  await options.click();
  await expect(page.getByRole("menu", { name: "Mono options" })).toBeVisible();
  await page.keyboard.press("Escape");

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

  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  const rows = directory.locator("[data-mono-status]");
  const order = await rows.locator("button:first-of-type").allTextContents();
  const from = (await rows.first().boundingBox())!;
  const to = (await rows.nth(2).boundingBox())!;
  await page.mouse.move(from.x + 44, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 44, to.y + to.height / 2, { steps: 8 });
  await expect(directory.locator("[data-dragging]")).toHaveCount(1);
  await page.mouse.up();
  await expect
    .poll(() => rows.locator("button:first-of-type").allTextContents())
    .not.toEqual(order);
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
  await page.keyboard.press("Tab");
  await longRow.focus();
  await expect(longRow).toBeFocused();
  await expect(longRow.locator("..")).toHaveCSS(
    "--tw-ring-offset-width",
    "1px",
  );
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
