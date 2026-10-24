import { describe, expect, test } from "bun:test";
import { checkReleaseAdvisories } from "./check-release-advisories";
const notice = { id: "release", severity: "critical", announce: true, affects: "<0.9.5", title: "Update", message: "Fix available", action: { kind: "update", label: "Update now" } };
const doc = (advisories: unknown[]) => JSON.stringify({ advisories });
describe("announcement-only publication", () => {
  test("accepts a critical notice for every installation without a release rebuild", () => {
    expect(() => checkReleaseAdvisories(doc([notice]), "v0.9.5")).not.toThrow();
  });
  test("rejects a notice whose fixed binary version has not been published", () => {
    expect(() => checkReleaseAdvisories(doc([{ ...notice, affects: "<0.9.6" }]), "v0.9.5")).toThrow("not published");
  });
  test("rejects invalid ranges, misspelled modes, duplicate ids and oversized data", () => {
    for (const data of [doc([{ ...notice, affects: "oops" }]), doc([{ ...notice, modes: ["desktpo"] }]), doc([notice, notice]), " ".repeat(128 * 1024 + 1)])
      expect(() => checkReleaseAdvisories(data, "v0.9.5")).toThrow();
  });
});
