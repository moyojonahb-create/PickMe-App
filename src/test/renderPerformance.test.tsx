/**
 * Render performance budget across mobile / tablet / desktop.
 *
 * We measure two things for each viewport:
 *   1. firstRenderMs   — wall-clock time from mount() to React committing
 *                        the initial PageSkeleton tree to the DOM.
 *   2. swapMs          — wall-clock time from skeleton mount → real
 *                        content mount (the moment the skeleton fades
 *                        out and the real component takes over).
 *
 * Thresholds are intentionally generous (jsdom is much slower than a
 * real browser) and only catch order-of-magnitude regressions.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, act } from "@testing-library/react";
import PageSkeleton from "@/components/PageSkeleton";

const VIEWPORTS = [
  { name: "mobile",  w: 390,  h: 844,  firstBudgetMs: 150, swapBudgetMs: 120 },
  { name: "tablet",  w: 820,  h: 1180, firstBudgetMs: 160, swapBudgetMs: 130 },
  { name: "desktop", w: 1366, h: 768,  firstBudgetMs: 170, swapBudgetMs: 150 },
];

function setViewport(w: number, h: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: h });
  window.dispatchEvent(new Event("resize"));
}

afterEach(cleanup);

function RealContent() {
  return <div data-testid="real-content">Loaded</div>;
}

describe.each(VIEWPORTS)(
  "render perf @ $name ($w×$h)",
  ({ w, h, firstBudgetMs, swapBudgetMs }) => {
    it(`first skeleton render < ${firstBudgetMs}ms`, () => {
      setViewport(w, h);
      const start = performance.now();
      render(<PageSkeleton variant="ride" />);
      const elapsed = performance.now() - start;
      expect(
        elapsed,
        `first render took ${elapsed.toFixed(2)}ms (budget ${firstBudgetMs}ms)`,
      ).toBeLessThan(firstBudgetMs);
    });

    it(`skeleton → real content swap < ${swapBudgetMs}ms`, async () => {
      setViewport(w, h);
      const { rerender } = render(<PageSkeleton variant="wallet" />);
      const start = performance.now();
      await act(async () => {
        rerender(<RealContent />);
      });
      const elapsed = performance.now() - start;
      expect(screen.getByTestId("real-content")).toBeInTheDocument();
      expect(
        elapsed,
        `swap took ${elapsed.toFixed(2)}ms (budget ${swapBudgetMs}ms)`,
      ).toBeLessThan(swapBudgetMs);
    });
  },
);
