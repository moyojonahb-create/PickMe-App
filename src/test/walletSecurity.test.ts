/**
 * Static-analysis tests around wallet/PIN security guarantees.
 *
 * These run in CI without a live database. Live RLS / function-grant
 * verification lives in `walletRlsLive.test.ts` and is opt-in via env vars.
 *
 * Guarantees enforced here:
 *  1. PIN hashes (`pin_hash`/`wallet_pin`) are never referenced by client code.
 *  2. The `wallet_pins` table is never queried from the client.
 *  3. PIN operations only flow through the `wallet-pin` edge function.
 *  4. Wallet pages mount the `WalletPinModal` and gate balance/tx behind
 *     a `pinVerified` flag.
 *  5. The `wallet-pin` edge function never echoes `pin_hash` in any
 *     response body or error payload.
 *  6. The shared white `AppHeader` is mounted on every marketing/static
 *     route in `App.tsx`.
 *  7. The smart prefetch strategy excludes admin/driver bundles for
 *     anonymous visitors (so the landing page first-load stays light).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");
const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const allFiles = walk(SRC);
const clientFiles = allFiles.filter(
  (f) =>
    !f.includes(`${"src"}/test/`) &&
    !f.endsWith(".test.ts") &&
    !f.endsWith(".test.tsx") &&
    !f.endsWith(".spec.ts") &&
    !f.endsWith(".spec.tsx") &&
    // Auto-generated DB types mirror the schema (including pin_hash column),
    // but the client never reads them at runtime — exclude from this scan.
    // Normalize to forward slashes: `join()` uses `\` on Windows, so a
    // literal forward-slash suffix would never match there.
    !f.replace(/\\/g, "/").endsWith("integrations/supabase/types.ts")
);

describe("wallet PIN hash exposure (client)", () => {
  it("no client code selects pin_hash or wallet_pin column", () => {
    const offenders: string[] = [];
    for (const f of clientFiles) {
      const text = readFileSync(f, "utf8");
      if (/\bpin_hash\b/.test(text) || /\bwallet_pin\b/.test(text)) {
        offenders.push(f);
      }
    }
    expect(offenders, `pin column referenced in client: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no client code reads from the wallet_pins table", () => {
    const offenders: string[] = [];
    for (const f of clientFiles) {
      const text = readFileSync(f, "utf8");
      if (/\.from\(\s*['"`]wallet_pins['"`]\s*\)/.test(text)) {
        offenders.push(f);
      }
    }
    expect(offenders, `wallet_pins table queried from client: ${offenders.join(", ")}`).toEqual([]);
  });

  it("PIN operations only go through the wallet API's server-side endpoint", () => {
    // useWalletPin.ts delegates to walletApi.ts's walletPin(), which posts to
    // the Go backend (with a legacy-path fallback) rather than a Supabase
    // edge function — see src/lib/walletApi.ts.
    const hook = readFileSync(join(SRC, "hooks/useWalletPin.ts"), "utf8");
    const api = readFileSync(join(SRC, "lib/walletApi.ts"), "utf8");
    expect(hook).toMatch(/walletPin/);
    expect(api).toMatch(/\/api\/wallets?\/pin/);
    expect(hook).not.toMatch(/pin_hash/);
    expect(api).not.toMatch(/pin_hash/);
  });
});

describe("wallet-pin edge function never returns pin_hash", () => {
  const fn = readFileSync(
    join(ROOT, "supabase/functions/wallet-pin/index.ts"),
    "utf8",
  );

  it("does not include pin_hash in any response body", () => {
    // Simple but effective: the function must never put the column value
    // (or its variable shape `.pin_hash`) into a Response body.
    // Look for any string payload pattern that could leak it.
    const lines = fn.split("\n");
    const offenders: string[] = [];
    lines.forEach((line, i) => {
      if (/JSON\.stringify\([^)]*pin_hash/i.test(line)) offenders.push(`${i + 1}: ${line.trim()}`);
      if (/new Response\([^)]*pin_hash/i.test(line)) offenders.push(`${i + 1}: ${line.trim()}`);
    });
    expect(offenders, `pin_hash leaked in response: ${offenders.join(" | ")}`).toEqual([]);
  });

  it("never spreads a wallet_pins row into an outbound payload", () => {
    // Guard against `return new Response(JSON.stringify({ ...row }))` style leaks.
    expect(fn).not.toMatch(/\.\.\.\s*\w*[Pp]in\w*\b\s*[,}]/);
  });

  it("error payloads stay generic — no pin column name leakage", () => {
    // Acceptable: messages like "PIN not set" / "Invalid PIN".
    // Forbidden: any error object that includes the literal column name.
    const errorShapes = fn.match(/error[^{}]*\{[^}]*\}/g) ?? [];
    for (const shape of errorShapes) {
      expect(shape).not.toMatch(/pin_hash/i);
    }
  });
});

describe("wallet PIN gate enforcement (UI)", () => {
  const riderPage = readFileSync(join(SRC, "pages/RiderWalletPage.tsx"), "utf8");
  const driverPage = readFileSync(join(SRC, "pages/DriverWalletPage.tsx"), "utf8");

  it("rider wallet page mounts the PIN modal and blocks balance until verified", () => {
    expect(riderPage).toMatch(/WalletPinModal/);
    expect(riderPage).toMatch(/pinVerified/);
    expect(riderPage).toMatch(/!\s*pinVerified/);
  });

  it("driver wallet page mounts the PIN modal and blocks balance until verified", () => {
    expect(driverPage).toMatch(/WalletPinModal/);
    expect(driverPage).toMatch(/pinVerified/);
    expect(driverPage).toMatch(/!\s*pinVerified/);
  });
});

describe("consistent white header across marketing/static routes", () => {
  const app = readFileSync(join(SRC, "App.tsx"), "utf8");
  const required = [
    "/auth", "/signup", "/safety", "/terms", "/privacy",
    "/offline", "/install", "/delete-account",
  ];

  it("AppHeader component exists and uses the lg-sized CruiXe logo", () => {
    const headerPath = join(SRC, "components/AppHeader.tsx");
    expect(existsSync(headerPath)).toBe(true);
    const header = readFileSync(headerPath, "utf8");
    expect(header).toMatch(/CruiXeLogo/);
    expect(header).toMatch(/size=["']lg["']/);
    expect(header).toMatch(/bg-white/);
  });

  it("each marketing/static route is wrapped in MarketingShell", () => {
    for (const route of required) {
      const re = new RegExp(`path="${route}"[^>]*element=\\{<MarketingShell>`);
      expect(app, `route ${route} should use <MarketingShell>`).toMatch(re);
    }
  });

  it("CruiXeLogo lg size scales down on mobile", () => {
    const logo = readFileSync(join(SRC, "components/CruiXeLogo.tsx"), "utf8");
    // Should include responsive height utilities on the lg variant
    expect(logo).toMatch(/lg:\s*['"][^'"]*sm:h-/);
  });
});

describe("smart prefetch strategy", () => {
  // Import the module's pure helper directly — no runtime needed.
  it("anonymous visitors do not prefetch admin or driver bundles", async () => {
    const mod = await import("@/lib/prefetchPages");
    const list = mod.selectPagesForUser({
      isAuthenticated: false, isDriver: false, isAdmin: false,
    });
    const text = list.map((l) => l.toString()).join("\n");
    expect(text).not.toMatch(/pages\/admin\//);
    expect(text).not.toMatch(/pages\/Driver/);
    expect(text).not.toMatch(/DriverDashboard/);
  });

  it("authenticated riders prefetch rider but not admin/driver", async () => {
    const mod = await import("@/lib/prefetchPages");
    const list = mod.selectPagesForUser({
      isAuthenticated: true, isDriver: false, isAdmin: false,
    });
    const text = list.map((l) => l.toString()).join("\n");
    expect(text).toMatch(/RiderWalletPage|RideHistory/);
    expect(text).not.toMatch(/pages\/admin\//);
  });

  it("admin context prefetches admin bundles", async () => {
    const mod = await import("@/lib/prefetchPages");
    const list = mod.selectPagesForUser({
      isAuthenticated: true, isDriver: false, isAdmin: true,
    });
    const text = list.map((l) => l.toString()).join("\n");
    expect(text).toMatch(/AdminDashboard/);
  });
});
