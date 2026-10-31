import { expect, test, type Locator } from "@playwright/test";

async function expectRowGeometry(
  row: Locator,
  sidebar: Locator,
  scopeCount: number,
) {
  const header = row.locator("[data-mono-header]");
  const dot = row.locator("[data-mono-status-dot]");
  const options = row.getByRole("button", { name: /options$/ });
  const scopes = row.locator("[data-mono-project-scope]");
  await expect(scopes).toHaveCount(scopeCount);
  const [headerBox, dotBox, optionsBox, sidebarBox] = await Promise.all(
    [header, dot, options, sidebar].map((locator) => locator.boundingBox()),
  );
  expect(headerBox).not.toBeNull();
  expect(dotBox).not.toBeNull();
  expect(optionsBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  const headerMiddle = headerBox!.y + headerBox!.height / 2;
  expect(Math.abs(dotBox!.y + dotBox!.height / 2 - headerMiddle)).toBeLessThan(2);
  expect(
    Math.abs(optionsBox!.y + optionsBox!.height / 2 - headerMiddle),
  ).toBeLessThan(2);
  for (let index = 0; index < scopeCount; index += 1) {
    const scope = scopes.nth(index);
    const scopeBox = await scope.boundingBox();
    expect(scopeBox).not.toBeNull();
    expect(scopeBox!.y).toBeGreaterThanOrEqual(
      headerBox!.y + headerBox!.height,
    );
    expect(scopeBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x);
    expect(scopeBox!.x + scopeBox!.width).toBeLessThanOrEqual(
      sidebarBox!.x + sidebarBox!.width + 1,
    );
  }
}

async function expectCompactRowGeometry(
  row: Locator,
  hasStatusDot: boolean,
) {
  await row.hover();
  const header = row.locator("[data-mono-header]");
  const mascot = header.locator("button > svg.pixel-mascot");
  const options = row.getByRole("button", { name: /options$/ });
  const dot = row.locator("[data-mono-status-dot]");
  await expect(options).toBeVisible();
  await expect(dot).toHaveCount(hasStatusDot ? 1 : 0);
  const [rowBox, headerBox, mascotBox, optionsBox, dotBox] =
    await Promise.all([
      row.boundingBox(),
      header.boundingBox(),
      mascot.boundingBox(),
      options.boundingBox(),
      hasStatusDot ? dot.boundingBox() : Promise.resolve(null),
    ]);
  expect(rowBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(mascotBox).not.toBeNull();
  expect(optionsBox).not.toBeNull();
  const rowMiddle = rowBox!.y + rowBox!.height / 2;
  expect(Math.abs(headerBox!.y + headerBox!.height / 2 - rowMiddle)).toBeLessThan(2);
  expect(Math.abs(mascotBox!.y + mascotBox!.height / 2 - rowMiddle)).toBeLessThan(2);
  expect(Math.abs(optionsBox!.y + optionsBox!.height / 2 - rowMiddle)).toBeLessThan(2);
  if (hasStatusDot) {
    expect(dotBox).not.toBeNull();
    expect(Math.abs(dotBox!.y + dotBox!.height / 2 - rowMiddle)).toBeLessThan(2);
  }
}

test("compact Projects centers every Mono header control in its h-8 row", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/tests/browser/monos-sidebar.html");

  const compact = page.locator('[data-mono-presentation="compact"]');
  const working = compact
    .locator('[data-mono-status="working"]')
    .filter({ hasText: "Design lead" });
  const idle = compact
    .locator('[data-mono-status="idle"]')
    .filter({ hasText: "Documentation reviewer" });
  const needsYou = compact
    .locator('[data-mono-status="needs-you"]')
    .filter({ hasText: "Release coordinator" });
  await expect(compact).toBeVisible();
  await expect(working.locator("button").first()).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expectCompactRowGeometry(working, true);
  await expectCompactRowGeometry(idle, true);

  const needsYouButton = needsYou.locator(
    "[data-mono-header] > button:not([data-no-drag])",
  );
  await needsYouButton.click();
  await expect(needsYouButton).toHaveAttribute("aria-current", "true");
  await expectCompactRowGeometry(needsYou, true);
  await page.screenshot({
    path: testInfo.outputPath("monos-compact-projects.png"),
    animations: "disabled",
  });

  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await page.setViewportSize({ width: 760, height: 820 });
  await needsYou.scrollIntoViewIfNeeded();
  await expectCompactRowGeometry(needsYou, true);
});

test("Monos directory uses the live rail components at desktop and minimum widths", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/tests/browser/monos-sidebar.html");
  await page.getByRole("button", { name: "Monos" }).click();

  const directory = page.locator('[data-mono-presentation="directory"]');
  const selectedRow = directory
    .locator("button:not([data-no-drag])")
    .filter({ hasText: "Design lead" });
  const selectedItem = selectedRow.locator("..").locator("..");
  const stressRow = directory
    .locator("button:not([data-no-drag])")
    .filter({ hasText: "VeryLongUnbrokenMonoName" });
  const stressItem = stressRow.locator("..").locator("..");
  const idleItem = directory
    .locator("button:not([data-no-drag])")
    .filter({ hasText: "Documentation reviewer" })
    .locator("..")
    .locator("..");
  const multipleItem = directory
    .locator("button:not([data-no-drag])")
    .filter({ hasText: "Release coordinator" })
    .locator("..")
    .locator("..");
  const emptyItem = directory
    .locator("button:not([data-no-drag])")
    .filter({ hasText: "Research assistant" })
    .locator("..")
    .locator("..");
  await expect(directory).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Project options", exact: true }),
  ).toHaveCount(0);
  await expect(selectedRow).toHaveAttribute("aria-current", "true");
  await expect(stressRow.locator("span.break-all")).toHaveCSS(
    "font-size",
    "15px",
  );
  const activeProject = selectedItem.locator("[data-mono-project-scope]");
  await expect(activeProject).toHaveAttribute(
    "data-mono-project-status",
    "working",
  );
  await expect(activeProject).toHaveAccessibleName(/Working.*MonoCode Desktop/);
  const stressProject = stressItem.locator("[data-mono-project-scope]");
  await expect(stressProject).toHaveAccessibleName(
    /Working.*VeryLongUnbrokenProjectNameThatMustRemainReadableAtTheMinimumRailWidth/,
  );
  await expect(stressProject).toHaveAttribute(
    "title",
    "/fixture/VeryLongUnbrokenProjectNameThatMustRemainReadableAtTheMinimumRailWidth",
  );
  await expect(stressProject.locator("button")).toHaveCount(0);
  await expect(stressProject.locator("span.break-all")).toHaveCSS(
    "font-size",
    "13px",
  );
  expect(
    await stressProject
      .locator("span.break-all")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await expect(idleItem.locator("[data-mono-project-scope]")).toHaveAttribute(
    "data-mono-project-status",
    "idle",
  );
  await expect(
    multipleItem.locator("[data-mono-project-scope]").first(),
  ).toHaveAttribute("data-mono-project-status", "needs-you");
  await expect(
    multipleItem.locator("[data-mono-project-scope]").nth(1),
  ).toHaveAttribute("data-mono-project-status", "working");
  await expect(emptyItem.locator("[data-mono-project-scope]")).toHaveCount(0);
  expect((await selectedRow.boundingBox())?.height).toBeGreaterThanOrEqual(56);
  await expectRowGeometry(selectedItem, directory, 1);
  await expectRowGeometry(stressItem, directory, 1);
  await expectRowGeometry(idleItem, directory, 1);
  await expectRowGeometry(multipleItem, directory, 2);
  await expectRowGeometry(emptyItem, directory, 0);

  const options = selectedItem.getByRole("button", { name: /options$/ });
  await expect(options).toBeVisible();
  await options.click();
  await expect(page.getByRole("menu", { name: "Mono options" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.screenshot({
    path: testInfo.outputPath("monos-directory-ordinary-dark-desktop.png"),
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Toggle theme" }).click();
  await page.screenshot({
    path: testInfo.outputPath("monos-directory-ordinary-light-desktop.png"),
    animations: "disabled",
  });

  await stressRow.click();
  await expect(stressRow).toHaveAttribute("aria-current", "true");
  await page.screenshot({
    path: testInfo.outputPath("monos-directory-stress-desktop.png"),
    animations: "disabled",
  });
  await selectedRow.click();
  await expect(selectedRow).toHaveAttribute("aria-current", "true");

  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await page.setViewportSize({ width: 760, height: 820 });
  await stressRow.scrollIntoViewIfNeeded();
  await expect(stressRow).toBeVisible();
  expect((await stressRow.boundingBox())?.height).toBeGreaterThanOrEqual(56);
  await expectRowGeometry(stressItem, directory, 1);
  await selectedItem.scrollIntoViewIfNeeded();
  await expectRowGeometry(selectedItem, directory, 1);
  await idleItem.scrollIntoViewIfNeeded();
  await expectRowGeometry(idleItem, directory, 1);
  await multipleItem.scrollIntoViewIfNeeded();
  await expectRowGeometry(multipleItem, directory, 2);
  await emptyItem.scrollIntoViewIfNeeded();
  await expectRowGeometry(emptyItem, directory, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("monos-directory-stress-200-percent.png"),
    animations: "disabled",
  });

  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
  await page.setViewportSize({ width: 1280, height: 820 });
  const rows = directory.locator("[data-mono-status]");
  await rows.first().scrollIntoViewIfNeeded();
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
  await expect(longRow.locator("..").locator("..")).toHaveCSS(
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
