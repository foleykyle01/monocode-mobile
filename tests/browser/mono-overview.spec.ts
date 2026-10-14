import { expect, test } from "@playwright/test";

test("Mono overview uses its existing list for attention, focuses the pending item and reaches the next", async ({ page }, testInfo) => {
  await page.goto("/tests/browser/mono-overview.html");
  await page.screenshot({ path: testInfo.outputPath("overview-lifecycle.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Needs you" }).click();
  await expect(page.locator("[data-mono-session]")).toHaveCount(2);
  await page.locator('[data-mono-session="approval"]').getByRole("button").first().click();
  await expect(page.locator("[data-pending-approval]")).toBeFocused();
  await expect(page.getByRole("button", { name: "Resolve fixture" })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("overview-attention.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Resolve fixture" }).click();
  await page.getByRole("button", { name: "Next waiting session" }).click();
  await expect(page.locator("[data-question-form]")).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("overview-question.png"), animations: "disabled" });
});
