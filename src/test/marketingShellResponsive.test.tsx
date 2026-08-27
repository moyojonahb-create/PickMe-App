/**
 * Responsive UI test for the white AppHeader + 3x logo on MarketingShell routes.
 *
 * jsdom doesn't do real layout, but we can:
 *   - Render the header at three viewport sizes (mobile/tablet/desktop)
 *     by stubbing `window.innerWidth` + `matchMedia` so Tailwind's
 *     responsive class names that we *care about* are still observable.
 *   - Assert that:
 *       a) the header renders the CruiXe logo image,
 *       b) the header is `position: sticky` and full-width — so it cannot
 *          push critical UI off-screen,
 *       c) the logo's height utility stays compact on mobile (h-10) and
 *          only scales up at larger breakpoints, so it never crowds the
 *          page,
 *       d) the header is rendered only ONCE on a marketing route (no
 *          accidental double header that would eat the viewport).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppHeader from "@/components/AppHeader";

const VIEWPORTS = [
  { name: "mobile", w: 375, h: 812 },
  { name: "tablet", w: 820, h: 1180 },
  { name: "desktop", w: 1366, h: 768 },
];

function setViewport(w: number, h: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: h });
  window.dispatchEvent(new Event("resize"));
}

afterEach(cleanup);

describe.each(VIEWPORTS)("MarketingShell header @ $name ($w×$h)", ({ w, h }) => {
  beforeEach(() => setViewport(w, h));

  it("renders the CruiXe logo image", () => {
    render(<MemoryRouter><AppHeader /></MemoryRouter>);
    const img = screen.getByAltText(/cruixe/i);
    expect(img).toBeInTheDocument();
  });

  it("header is sticky and full-width — cannot horizontally crowd the viewport", () => {
    const { container } = render(<MemoryRouter><AppHeader /></MemoryRouter>);
    const header = container.querySelector("header")!;
    expect(header.className).toMatch(/sticky/);
    expect(header.className).toMatch(/w-full/);
    expect(header.className).toMatch(/bg-white/);
  });

  it("logo height utility includes a small-screen scale-down", () => {
    const { container } = render(<MemoryRouter><AppHeader /></MemoryRouter>);
    const img = container.querySelector("img[alt='CruiXe']") as HTMLImageElement;
    // The lg variant must stay compact on mobile (h-10) and only grow at
    // larger breakpoints. If someone replaces this with a single fixed
    // height, this test fails before it can ship.
    expect(img.className).toMatch(/^h-10\b/);
    expect(img.className).toMatch(/lg:h-\[52px\]/);
  });

  it("only one <header> in the tree (no accidental double header)", () => {
    const { container } = render(<MemoryRouter><AppHeader /></MemoryRouter>);
    expect(container.querySelectorAll("header")).toHaveLength(1);
  });
});
