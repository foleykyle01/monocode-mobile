import { expect, test } from "@playwright/test";

test("a narrow phone keeps the reader anchored through streaming, queue receipts and completion", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/phone-transcript.html");
  const transcript = page.locator(".transcript");
  await transcript.evaluate(element => { element.scrollTop = 400; element.dispatchEvent(new Event("scroll")); });
  await page.getByRole("button", { name: "Stream chunk" }).click();
  await expect(page.getByRole("region", { name: "Queued follow-ups" })).toContainText("Review accessibility next");
  await page.getByRole("button", { name: "Complete activity" }).click();
  await expect(page.locator(".activity-tree__heading")).toHaveAttribute("aria-expanded", "true");
  expect(await transcript.evaluate(element => element.scrollTop)).toBe(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: info.outputPath("phone-long-transcript.png"), animations: "disabled" });
});

test("connection and pairing share accessible controls", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/browser/mono-linked.html?demo=1");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: "Mac unreachable", exact: true }).check();
  await expect(page.locator(".connection-notice")).toBeVisible();
  await page.screenshot({ path: info.outputPath("connection.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Preview connection setup" }).click();
  await expect(page.getByRole("heading", { name: "Connect to your Mac" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("pairing.png"), animations: "disabled" });
});

test("reduced transparency makes shared glass surfaces solid", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium", "Media emulation for reduced transparency uses Chromium's fixture protocol.");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  await page.goto("/tests/browser/mono-overview.html");
  await page.getByRole("button", { name: "Interface settings" }).click();
  const glass = page.getByRole("dialog").locator(".glass-backdrop");
  await expect(glass).toHaveCSS("backdrop-filter", "none");
  await page.screenshot({ path: info.outputPath("mac-solid-dialog.png"), animations: "disabled" });
});

for (const theme of ["dark", "light"]) test(`phone surfaces remain readable and retain navigation in ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(value => localStorage.setItem("companion.preview.appearance.v1", value), theme);
  await page.goto("/tests/browser/mono-linked.html?demo=1");
  const shot = async (name: string) => page.screenshot({ path: info.outputPath(`${name}.png`), animations: "disabled" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await shot("settings");
  await page.getByRole("button", { name: "Back from settings" }).click();
  await page.locator(".inbox-navigation-button").click();
  await expect(page.locator(".inbox-row").first()).toBeVisible();
  await shot("inbox");
  await page.locator(".inbox-row").first().click();
  await expect(page.locator(".inbox-detail")).toBeVisible();
  await shot("inbox-detail");
  await page.locator(".inbox-back").click();
  await expect(page.locator(".inbox-row").first()).toBeFocused();
  await page.locator(".inbox-back").click();
  await page.locator(".mono-card").first().locator(".mono-details-button").click();
  await expect(page.locator(".mono-details-card").first()).toBeVisible();
  await shot("mono-details");
  await page.locator(".mono-details-header .back-button").click();
  await page.getByRole("button", { name: /^Changes in/ }).first().click();
  await expect(page.locator(".changed-file").first()).toBeVisible();
  await shot("changes");
  await page.locator(".changed-file").first().click();
  await expect(page.locator(".changes-diff")).toBeVisible();
  await shot("file-review");
  await page.getByRole("button", { name: "Back to changes", exact: true }).click();
  await page.getByRole("button", { name: "Back to workspace", exact: true }).click();
  await page.locator(".mono-row").filter({ hasText: "Scout" }).click();
  await page.getByRole("textbox", { name: "Message this session" }).fill("Keep this draft");
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Back to workspace", exact: true }).click();
    await page.locator(".mono-row").filter({ hasText: "Scout" }).click();
  }
  await expect(page.getByRole("textbox", { name: "Message this session" })).toHaveValue("Keep this draft");
  await page.getByRole("button", { name: /^Review release notes monocode/ }).click();
  await page.locator(".setting-trigger").first().click();
  await expect(page.getByRole("dialog", { name: "Change model" })).toBeVisible();
  await shot("phone-picker");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("region", { name: "Session changes" })).toContainText("README.md");
  await shot("session-review");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) test(`Mac dialogs and navigation with ${reducedMotion}`, async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion });
  await page.goto("/tests/browser/mono-overview.html");
  if (reducedMotion === "reduce") await page.evaluate(() => document.documentElement.classList.add("theme-light"));
  await page.getByRole("button", { name: "Interface settings" }).click();
  await page.screenshot({ path: info.outputPath("mac-dialog.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.screenshot({ path: info.outputPath("mac-picker.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-mono-session="approval"]').getByRole("button").first().click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
  }
  await expect(page.locator('[data-mono-session="approval"]')).toBeVisible();
  await expect(page.locator('[aria-hidden="true"] [data-pending-approval]')).toHaveCount(0);
});
