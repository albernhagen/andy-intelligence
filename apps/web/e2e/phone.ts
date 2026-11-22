import { expect, type Page } from "@playwright/test";

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
