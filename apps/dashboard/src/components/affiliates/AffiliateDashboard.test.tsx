// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AffiliateDashboard } from "./AffiliateDashboard";
import { payoutCents } from "./affiliate-presentation";
import { baseDictionary } from "@/i18n";

const h = vi.hoisted(() => ({ request: vi.fn(), user: "alice" }));
vi.mock("@/lib/api/affiliates", () => ({ affiliateRequest: h.request }));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: h.user }, session: { activeOrganizationId: "team" } } }),
}));
vi.mock("@/components/i18n-provider", () => ({
  useI18n: () => ({ t: baseDictionary, locale: "en" }),
}));
vi.mock("@/components/billing/useCloudBilling", () => ({
  useCloudPlans: () => ({ payload: { plans: [] } }),
}));
let root: Root, host: HTMLDivElement;
const state = () => ({
  available: true,
  program: { version: 1, policies: [] },
  member: { enabled: true, payoutMinimumCents: 5000 },
  summary: {
    currency: "usd",
    available: 6500,
    earned: 10000,
    reversed: 500,
    credited: 9500,
    reserved: 2000,
    paid: 1000,
    referrals: 2,
    converted: 2,
  },
});
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
const render = () =>
  act(async () => {
    root.render(<AffiliateDashboard key={h.user} />);
  });
async function amount(value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.user = "alice";
  h.request.mockReset();
  h.request.mockImplementation(async (name) =>
    name === "overview" ? state() : { total: 0, items: [] },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("shows separate cash totals and enforces the per-user payout minimum in the form", async () => {
  await render();
  expect(host.textContent).toContain("$65.00");
  expect(host.textContent).toContain("$50.00");
  await amount("49.99");
  expect(button("Request payout").disabled).toBe(true);
  await amount("50");
  expect(button("Request payout").disabled).toBe(false);
  h.request.mockImplementation(async (name) => {
    if (name === "requestPayout") throw new Error("Connection interrupted");
    return name === "overview" ? state() : { total: 0, items: [] };
  });
  await act(async () => button("Request payout").click());
  await act(async () => button("Request payout").click());
  const calls = h.request.mock.calls.filter(([name]) => name === "requestPayout");
  expect(calls).toHaveLength(2);
  expect(calls[0][1]).toEqual(calls[1][1]);
  expect(calls[0][1].amountCents).toBe(5000);
});
it("keeps private results and drafts out of a different account", async () => {
  let resolve!: (value: unknown) => void;
  h.request.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await render();
  h.user = "bob";
  h.request.mockResolvedValue({ ...state(), available: false });
  await render();
  await act(async () => resolve(state()));
  expect(host.textContent).toContain("not available yet");
  expect(host.textContent).not.toContain("$65.00");
});
it("shows an unavailable state instead of fabricated earnings when the provider fails", async () => {
  h.request.mockRejectedValue(new Error("Provider unavailable"));
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Provider unavailable");
  expect(host.textContent).not.toContain("$0.00");
  expect(button("Try again")).toBeDefined();
});
it("handles money as decimal cents and rejects exponent, fractional-cent and unsafe inputs", () => {
  expect(payoutCents("50.01")).toBe(5001);
  expect(payoutCents("50")).toBe(5000);
  for (const input of ["5e3", "50.001", "-1", "Infinity", "999999999999999999", "", "0.99"])
    expect(payoutCents(input)).toBeNull();
});
