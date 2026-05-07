/**
 * Tests for persistent prefetch cache + RouteErrorBoundary.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  recordPrefetched,
  warmFromCache,
  clearPrefetchCache,
  HIGH_PRIORITY_ROUTES,
} from "@/lib/persistentPrefetch";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";

beforeEach(() => {
  clearPrefetchCache();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});
afterEach(cleanup);

describe("persistentPrefetch", () => {
  it("only records routes in the high-priority allowlist", () => {
    const s = document.createElement("script");
    s.type = "module";
    s.src = "https://cdn.example/assets/Ride.abc.js";
    document.body.appendChild(s);

    recordPrefetched("/ride");
    recordPrefetched("/admin/dashboard"); // not allowlisted — must be ignored

    warmFromCache();
    const links = Array.from(
      document.head.querySelectorAll('link[rel="modulepreload"]'),
    ) as HTMLLinkElement[];
    expect(links).toHaveLength(1);
    expect(links[0].href).toContain("Ride.abc.js");
  });

  it("warmFromCache is idempotent — does not duplicate preload links", () => {
    const s = document.createElement("script");
    s.type = "module";
    s.src = "https://cdn.example/assets/Wallet.def.js";
    document.body.appendChild(s);
    recordPrefetched("/wallet");
    warmFromCache();
    warmFromCache();
    warmFromCache();
    const links = document.head.querySelectorAll('link[rel="modulepreload"]');
    expect(links).toHaveLength(1);
  });

  it("exposes the high-priority route list", () => {
    expect(HIGH_PRIORITY_ROUTES).toEqual(["/ride", "/wallet", "/profile"]);
  });
});

describe("RouteErrorBoundary", () => {
  function Boom(): JSX.Element {
    throw new Error("kaboom");
  }

  it("shows skeleton + retry banner when a child throws", () => {
    // Suppress noisy React error logging for this controlled throw.
    const orig = console.error;
    console.error = () => {};
    try {
      render(
        <RouteErrorBoundary variant="wallet">
          <Boom />
        </RouteErrorBoundary>,
      );
    } finally {
      console.error = orig;
    }
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/couldn't load this screen/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("retry resets the boundary so children can re-mount", () => {
    let shouldThrow = true;
    function Maybe() {
      if (shouldThrow) throw new Error("transient");
      return <div data-testid="ok">recovered</div>;
    }
    const orig = console.error;
    console.error = () => {};
    try {
      render(
        <RouteErrorBoundary>
          <Maybe />
        </RouteErrorBoundary>,
      );
      shouldThrow = false;
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    } finally {
      console.error = orig;
    }
    expect(screen.getByTestId("ok")).toBeInTheDocument();
  });
});
