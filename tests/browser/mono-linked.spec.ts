import { expect, test } from "@playwright/test";

test("a Mono opens its project sessions with normal chat controls and returns to its draft", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/browser/mono-linked.html?demo=1");
  await page.locator(".mono-row").filter({ hasText: "Scout" }).click();
  const draft = page.getByRole("textbox", { name: "Message this session" });
  await draft.fill("Bring the results back here");
  const card = page.getByRole("button", { name: "Build the companion window monocode · Needs approval", exact: true });
  await expect(card).toBeVisible();
  await expect(page.locator(".spawned-session")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: testInfo.outputPath("mono-links.png") });
  await card.click();
  await expect(page.locator(".conversation-title")).toHaveText("Build the companion window");
  await expect(page.getByRole("button", { name: "Stop agent", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await expect(page.getByRole("button", { name: "Allow", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeVisible();
  await draft.fill("Continue the implementation");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("Continue the implementation", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("linked-session.png") });
  await page.getByRole("button", { name: "Back to Scout", exact: true }).click();
  await expect(page.locator(".conversation-title")).toHaveText("Scout");
  await expect(draft).toHaveValue("Bring the results back here");
  await expect(page.locator(".spawned-session").first()).toContainText("Ready");
});
