import { expect, test } from "@playwright/test";

test("status dots stay aligned with Git details, hover, focus and collapsed groups", async ({ page }) => {
  await page.goto("/tests/browser/project-activity.html");
  const rows = page.locator("[data-project-group-items] [data-project-activity]");
  await expect(rows).toHaveCount(3);
  await expect(page.getByText("+123", { exact: true })).toBeVisible();
  const dots = rows.locator('[role="img"]');
  const positions = async () => dots.evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { x: box.x, width: box.width, height: box.height };
  }));
  const initial = await positions();
  expect(new Set(initial.map(dot => dot.x)).size).toBe(1);
  expect(initial.every(dot => dot.width === 8 && dot.height === 8)).toBe(true);
  for (let i = 0; i < 3; i++) {
    const row = rows.nth(i);
    await row.hover();
    const options = row.getByRole("button", { name: "Project options", exact: true });
    await expect(options).toBeVisible();
    expect(await positions()).toEqual(initial);
    const menuBox = (await options.boundingBox())!;
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(initial[i].x);
    await options.focus();
    await page.mouse.move(900, 700);
    expect(await positions()).toEqual(initial);
    await row.evaluate(element => element.setAttribute("data-reordering", "true"));
    expect(await positions()).toEqual(initial);
    await row.evaluate(element => element.removeAttribute("data-reordering"));
  }
  const header = page.getByRole("button", { name: /^Work, 3 projects/ });
  await header.click();
  const groupDot = header.locator('[role="img"]');
  const before = await groupDot.boundingBox();
  await header.hover();
  expect(await groupDot.boundingBox()).toEqual(before);
});

test("Mono dots and count bubbles share the project column through hover, focus and selection", async ({ page }) => {
  await page.goto("/tests/browser/project-activity.html");
  const projectDot = page.getByRole("button", { name: /ungrouped.*completed, unread/ }).locator('[role="img"]');
  const projectBox = (await projectDot.boundingBox())!;
  const centerX = projectBox.x + projectBox.width / 2;
  const rows = page.locator("[data-mono-rail] [data-mono-status]");
  await expect(rows).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    const row = rows.nth(i);
    const badge = row.locator("[data-mono-status-dot]");
    await expect(badge).toHaveText(["", "1", "12", "99+"][i]);
    const assertPosition = async () => {
      const box = (await badge.boundingBox())!;
      const rowBox = (await row.boundingBox())!;
      expect(box.x + box.width / 2).toBeCloseTo(centerX);
      expect(box.y + box.height / 2).toBeCloseTo(rowBox.y + rowBox.height / 2);
      return box;
    };
    const initial = await assertPosition();
    expect(initial.width).toBe(i ? 16 : 8);
    expect(initial.height).toBe(initial.width);
    await row.hover();
    const options = row.getByRole("button", { name: /options$/ });
    await expect(options).toBeVisible();
    const menuBox = (await options.boundingBox())!;
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual((await assertPosition()).x);
    await options.focus();
    await page.mouse.move(900, 700);
    await assertPosition();
    await row.locator("button").first().click();
    await expect(row).toHaveAttribute("data-selected", "true");
    await expect(badge).toHaveText("");
    await assertPosition();
  }
});
