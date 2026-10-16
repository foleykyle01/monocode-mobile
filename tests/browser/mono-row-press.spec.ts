import { expect, test } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  test(`expanded Mono presses fill the row without an inset overlay (${theme})`, async ({ page }, testInfo) => {
    await page.goto("/tests/browser/project-activity.html");
    await page.evaluate(light => document.documentElement.classList.toggle("theme-light", light), theme === "light");
    const row = page.locator("[data-mono-rail] [data-mono-status]").first();
    const primary = row.locator("button").first();
    const box = (await row.boundingBox())!;
    let pressedColor: string | undefined;
    // Hold the name, mascot and left padding separately: a released click hides
    // the inset fill caused by the generic button :active rule.
    for (const [area, offset] of [["name", 48], ["mascot", 16], ["padding", 4]] as const) {
      await page.locator("[data-mono-rail] [data-mono-status]").last().locator("button").first().click();
      await expect(row).not.toHaveAttribute("data-selected");
      await page.mouse.move(box.x + offset, box.y + box.height / 2);
      await page.mouse.down();
      await row.screenshot({ path: testInfo.outputPath(`${theme}-${area}-held.png`) });
      await expect(primary).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      const pressed = await row.evaluate(el => getComputedStyle(el).backgroundColor);
      expect(pressed).not.toBe("rgba(0, 0, 0, 0)");
      if (pressedColor) expect(pressed).toBe(pressedColor);
      pressedColor = pressed;
      await page.mouse.up();
      await expect(row).toHaveAttribute("data-selected", "true");
      await expect(primary).toHaveAttribute("aria-current", "true");
      await expect(primary).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      expect(await row.boundingBox()).toEqual(box);
      await row.screenshot({ path: testInfo.outputPath(`${theme}-${area}-selected.png`) });
    }
    // Re-press a selected card: no second inset fill may cover the selection.
    await primary.hover();
    await page.mouse.down();
    await expect(primary).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(row).toHaveCSS("background-color", pressedColor!);
    await page.mouse.up();

    const project = page.locator('.reorder-item.project-reorder-item:not([data-mono-status])').first();
    await project.locator("button").first().hover();
    await page.mouse.down();
    await expect(project.locator("button").first()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(project).toHaveCSS("background-color", pressedColor!);
    await page.mouse.up();
  });

  test(`row feedback preserves options, keyboard selection and drag (${theme})`, async ({ page, browserName }) => {
    await page.goto("/tests/browser/project-activity.html");
    await page.evaluate(light => document.documentElement.classList.toggle("theme-light", light), theme === "light");
    const rows = page.locator("[data-mono-rail] [data-mono-status]");
    await rows.first().locator("button").first().click();
    const second = rows.nth(1);
    await second.hover();
    const options = second.getByRole("button", { name: /options$/ });
    const background = await second.evaluate(el => getComputedStyle(el).backgroundColor);
    await options.hover();
    await page.mouse.down();
    await expect(options).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(second).toHaveCSS("background-color", background);
    await page.mouse.up();
    await expect(page.getByRole("menuitem", { name: "Delete mono…", exact: true })).toBeVisible();
    await expect(rows.first()).toHaveAttribute("data-selected", "true");
    await expect(second).not.toHaveAttribute("data-selected");
    await page.keyboard.press("Escape");

    const primary = second.locator("button").first();
    await primary.focus();
    // WebKit's default macOS keyboard mode uses Option-Tab for buttons.
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(options).toBeFocused();
    await page.keyboard.press(browserName === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab");
    await expect(primary).toBeFocused();
    await expect(primary).toHaveCSS("outline-style", "solid");
    await page.keyboard.down("Space");
    await expect(primary).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(second).not.toHaveCSS("background-color", background);
    await page.keyboard.up("Space");
    await expect(second).toHaveAttribute("data-selected", "true");
    await rows.nth(2).locator("button").first().focus();
    await page.keyboard.press("Enter");
    const selectedName = await rows.nth(2).locator("button").first().textContent();
    await expect(rows.nth(2)).toHaveAttribute("data-selected", "true");

    const order = await rows.locator("button:first-of-type").allTextContents();
    const from = (await rows.first().boundingBox())!;
    const to = (await rows.last().boundingBox())!;
    await page.mouse.move(from.x + 45, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 45, to.y + to.height / 2, { steps: 8 });
    await expect(page.locator("[data-mono-rail] [data-dragging]")).toHaveCount(1);
    await expect(page.locator("[data-mono-rail] [data-dragging] [data-no-drag]")).toBeHidden();
    await page.mouse.up();
    await expect.poll(() => rows.locator("button:first-of-type").allTextContents()).not.toEqual(order);
    await expect(page.locator("[data-mono-rail] [data-selected] > button").first()).toHaveText(selectedName!);
    await expect(page.locator("[data-mono-rail] [data-reordering]")).toHaveCount(0);
  });
}
