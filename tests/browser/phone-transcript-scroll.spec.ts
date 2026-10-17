import { expect, test } from "@playwright/test";

test("phone chats open at latest after hydration, switches, and linked navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/phone-transcript.html");
  const transcript = page.locator(".transcript");
  const bottomGap = () => transcript.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop);
  const expectLatest = () => expect.poll(bottomGap).toBeLessThanOrEqual(1);

  await expect(transcript).toContainText("Loading conversation…");
  await page.getByRole("button", { name: "Hydrate transcript" }).click();
  await expectLatest();
  await page.getByRole("button", { name: "Add late layout" }).click();
  await expectLatest();
  await page.getByRole("button", { name: "Grow rendered content" }).click();
  await expectLatest();

  await transcript.hover();
  await page.mouse.wheel(0, -400);
  await expect.poll(bottomGap).toBeGreaterThan(64);
  await page.getByRole("button", { name: "Open chat B" }).click();
  await expectLatest();
  await page.getByRole("button", { name: "Open chat A" }).click();
  await expectLatest();

  await page.getByRole("button", { name: "Linked project repo · Status unknown", exact: true }).click();
  await expectLatest();
  await page.getByRole("button", { name: "Back to parent" }).click();
  await expectLatest();
});

test("phone transcript keeps deliberate reading and history anchors", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tests/browser/phone-transcript.html");
  await page.getByRole("button", { name: "Hydrate transcript" }).click();
  const transcript = page.locator(".transcript");
  const bottomGap = () => transcript.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop);
  await page.getByRole("button", { name: "Grow rendered content" }).click();
  await expect.poll(bottomGap).toBeLessThanOrEqual(1);
  await transcript.hover();
  await page.mouse.wheel(0, -400);
  await expect.poll(bottomGap).toBeGreaterThan(64);
  const beforeReflow = await transcript.evaluate(element => element.scrollTop);
  await page.getByRole("button", { name: "Grow rendered content" }).click();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await transcript.evaluate(element => element.scrollTop)).toBe(beforeReflow);
  await page.getByRole("button", { name: "Stream chunk" }).click();
  expect(await transcript.evaluate(element => element.scrollTop)).toBe(beforeReflow);
  await page.setViewportSize({ width: 390, height: 700 });
  expect(await transcript.evaluate(element => element.scrollTop)).toBe(beforeReflow);

  const before = await transcript.evaluate(element => ({ height: element.scrollHeight, top: element.scrollTop }));
  await page.getByRole("button", { name: "Load earlier messages" }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(transcript).toContainText("Older A paragraph 1");
  const after = await transcript.evaluate(element => ({ height: element.scrollHeight, top: element.scrollTop }));
  expect(Math.abs(after.top - (before.top + after.height - before.height))).toBeLessThanOrEqual(1);
});
