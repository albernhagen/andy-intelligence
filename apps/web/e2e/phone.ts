import { expect, type Locator, type Page } from "@playwright/test";

/**
 * AI-325: Phone: no screen scrolls sideways. The page is never wider than the viewport; a strip
 * that scrolls inside its own container (a lane strip, a code block) doesn't widen the page. On a
 * failure the message names the elements at the page's right edge, so the fix can start there.
 */
export async function expectPageFits(page: Page) {
  const { scrollWidth, width, wide } = await page.evaluate(() => {
    const scrollWidth = document.documentElement.scrollWidth;
    // The deepest elements whose right edge sets the page width: usually the one to fix.
    const wide = [...document.body.querySelectorAll("*")]
      .filter((el) => el.getBoundingClientRect().right >= scrollWidth - 1)
      .slice(-3)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
    return { scrollWidth, width: window.innerWidth, wide };
  });
  const message = `page is ${scrollWidth} px wide at ${width}; widest: ${wide.join("; ")}`;
  expect(scrollWidth, message).toBeLessThanOrEqual(width);
}

/**
 * AI-334: every control in `scope` is a 44 px tall target on a phone (design.md). A checkbox's
 * target is its label. On a failure the message lists each small control and its height.
 */
export async function expectTouchTargets(scope: Locator) {
  const small = await scope.evaluate((root) =>
    [...root.querySelectorAll("input, select, button, textarea")]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const target = el.closest("label") ?? el;
        const name = el.getAttribute("aria-label") ?? target.textContent?.trim().slice(0, 30);
        return { name, height: Math.round(target.getBoundingClientRect().height) };
      })
      .filter((c) => c.height < 44),
  );
  expect(small, "controls under 44 px").toEqual([]);
}
