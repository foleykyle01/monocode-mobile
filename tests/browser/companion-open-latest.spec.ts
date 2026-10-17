import { expect, test } from "@playwright/test";

test("phone reopening the same Mono or project chat follows latest", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto("/tests/browser/mono-linked.html?demo=1");
  const transcript = page.locator(".transcript");
  const bottomGap = () => transcript.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop);
  const expectLatest = () => expect.poll(bottomGap).toBeLessThanOrEqual(1);
  const scrollUp = async () => {
    await transcript.hover();
    await page.mouse.wheel(0, -400);
    await expect.poll(bottomGap).toBeGreaterThan(64);
  };
  const openScout = () => page.locator(".mono-row").filter({ hasText: "Scout" }).click();
  const openReleaseNotes = () => page.locator(".session-row").filter({ hasText: "Review release notes" }).click();

  // The initial selected Mono hydrates while its phone pane is still hidden.
  await expect(page.locator(".session-detail")).not.toBeVisible();
  await expect(transcript).toContainText("I’ve started two sessions in MonoCode.");
  await openScout();
  await expectLatest();
  await scrollUp();
  const beforeLinkedOverlay = await transcript.evaluate(element => element.scrollTop);
  await page.getByRole("button", { name: /Sessions for Scout/ }).click();
  await page.getByRole("button", { name: "Close sessions", exact: true }).click();
  expect(await transcript.evaluate(element => element.scrollTop)).toBe(beforeLinkedOverlay);
  await page.getByRole("button", { name: "Back to workspace", exact: true }).click();
  await openScout();
  await expectLatest();

  // Settings is opened from workspace, so coming back to this same chat is a new visit.
  await page.getByRole("button", { name: "Back to workspace", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Back from settings", exact: true }).click();
  await openScout();
  await expectLatest();

  await page.getByRole("button", { name: "Back to workspace", exact: true }).click();
  await openReleaseNotes();
  await expectLatest();
  await scrollUp();
  await page.getByRole("button", { name: "Back to workspace", exact: true }).click();
  await openReleaseNotes();
  await expectLatest();
});
