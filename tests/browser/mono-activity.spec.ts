import { expect, test } from "@playwright/test";

test("an inactive Mono follows child activity and respects reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/mono-overview.html?activity");
  const inactive = page.locator(
    "[data-mono-rail] [data-mono-status]:not([data-selected])",
  );
  await expect(inactive).toHaveAttribute("data-mono-status", "idle");
  await page.getByRole("button", { name: "Start child", exact: true }).click();
  await expect(inactive).toHaveAttribute("data-mono-status", "working");
  await expect(inactive.getByRole("button", { name: /Working/ })).toBeVisible();
  const dot = inactive.locator("span.rounded-full");
  await expect(dot).toHaveCSS("animation-name", "none");
  await page
    .getByRole("button", { name: "Child needs input", exact: true })
    .click();
  await expect(inactive).toHaveAttribute("data-mono-status", "needs-you");
  await expect(
    inactive.getByRole("button", { name: /Needs you/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Finish child", exact: true }).click();
  await expect(inactive).toHaveAttribute("data-mono-status", "idle");
  await expect(
    page.getByRole("heading", { name: "Another Mono is open" }),
  ).toBeVisible();
});
