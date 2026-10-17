import { expect, test } from "@playwright/test";

test("phone reopening the same Mono or project chat follows latest", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto("/tests/browser/mono-linked.html?demo=1");
  const detail = page.locator(".session-detail.mobile-detail-open");
  const transcript = () => detail.locator(".transcript");
  const geometry = (target: ReturnType<typeof transcript>) => target.evaluate(element => ({
    bottomGap: element.scrollHeight - element.clientHeight - element.scrollTop,
    clientHeight: element.clientHeight,
    overflow: element.scrollHeight - element.clientHeight,
  }));
  const expectLatest = async (target: ReturnType<typeof transcript>) => {
    await expect.poll(async () => (await geometry(target)).clientHeight).toBeGreaterThan(0);
    await expect.poll(async () => (await geometry(target)).overflow).toBeGreaterThan(64);
    await expect.poll(async () => (await geometry(target)).bottomGap).toBeLessThanOrEqual(1);
  };
  const expectOpen = async (title: string, content: string) => {
    await expect(detail).toBeVisible();
    await expect(page.locator(".conversation-title")).toHaveText(title);
    const target = transcript();
    await expect(target).toBeVisible();
    await expect(target).toContainText(content);
    await expectLatest(target);
    return target;
  };
  const scrollUp = async (target: ReturnType<typeof transcript>) => {
    await expect.poll(async () => (await geometry(target)).overflow).toBeGreaterThan(64);
    await target.hover();
    await page.mouse.wheel(0, -600);
    await expect.poll(async () => (await geometry(target)).bottomGap).toBeGreaterThan(64);
  };
  const openScout = () => page.locator(".session-panel.mobile-list-open .mono-row").filter({ hasText: "Scout" }).click();
  const openReleaseNotes = () => page.locator(".session-panel.mobile-list-open .session-row").filter({ hasText: "Review release notes" }).click();

  // The initial selected Mono hydrates while its phone pane is still hidden.
  await expect(page.locator(".session-detail")).not.toBeVisible();
  await expect(page.locator(".session-detail .transcript")).toContainText("I’ve started two sessions in MonoCode.");
  await openScout();
  const scout = await expectOpen("Scout", "I’ve started two sessions in MonoCode.");
  await scrollUp(scout);
  await scout.evaluate(element => element.setAttribute("data-test-instance", "scout"));
  const beforeLinkedOverlay = await scout.evaluate(element => element.scrollTop);
  await page.getByRole("button", { name: /Sessions for Scout/ }).click();
  await page.getByRole("button", { name: "Close sessions", exact: true }).click();
  expect(await scout.evaluate(element => element.scrollTop)).toBe(beforeLinkedOverlay);
  await page.getByRole("button", { name: "Back to workspace", exact: true }).click();
  await openScout();
  const reopenedScout = await expectOpen("Scout", "I’ve started two sessions in MonoCode.");
  await expect(reopenedScout).toHaveAttribute("data-test-instance", "scout");

  // Settings is opened from workspace, so coming back to this same chat is a new visit.
  await page.getByRole("button", { name: "Back to workspace", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Back from settings", exact: true }).click();
  await openScout();
  await expectOpen("Scout", "I’ve started two sessions in MonoCode.");

  await page.getByRole("button", { name: "Back to workspace", exact: true }).click();
  await openReleaseNotes();
  const releaseNotes = await expectOpen("Review release notes", "Ready for review");
  await scrollUp(releaseNotes);
  await releaseNotes.evaluate(element => element.setAttribute("data-test-instance", "release-notes"));
  await page.getByRole("button", { name: "Back to workspace", exact: true }).click();
  await openReleaseNotes();
  const reopenedReleaseNotes = await expectOpen("Review release notes", "Ready for review");
  await expect(reopenedReleaseNotes).toHaveAttribute("data-test-instance", "release-notes");
});
