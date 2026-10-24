import { describe, expect, it, vi } from "vitest";

import { releaseDocuments, MAX_RELEASE_ADVISORY_BYTES } from "../src/updates/release-documents";
import { findAnnouncement } from "../src/updates/advisories";

const RELEASE_URL = "https://api.github.com/repos/oblien/openship/releases/latest";
const CHANGELOG_URL = "https://raw.githubusercontent.com/oblien/openship/v0.6.9/CHANGELOG.md";
const MANIFEST_URL =
  "https://raw.githubusercontent.com/oblien/openship/main/release-advisories.json";
const TAGGED_MANIFEST_URL = MANIFEST_URL.replace("/main/", "/v0.6.9/");

function response(body: BodyInit, init?: ResponseInit): Response {
  return new Response(body, { status: 200, ...init });
}

describe("releaseDocuments", () => {
  it("uses the tagged changelog instead of the GitHub release body", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === RELEASE_URL) {
        return response(JSON.stringify({ tag_name: "v0.6.9", body: "Bump commit title" }));
      }
      if (url === CHANGELOG_URL) {
        return response(`# Changelog

## 0.6.9

The real product notes.

## 0.6.8

Older notes.`);
      }
      if (url === MANIFEST_URL) return response(JSON.stringify({ advisories: [] }));
      return response("", { status: 404 });
    });

    const result = await releaseDocuments("v0.6.9", fetcher as typeof fetch);

    expect(result.latest).toEqual({
      version: "0.6.9",
      tag: "v0.6.9",
      notes: "The real product notes.",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps advisories when changelog body reading fails", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === RELEASE_URL) return response(JSON.stringify({ tag_name: "v0.6.9" }));
      if (url === CHANGELOG_URL) {
        return { ok: true, text: async () => Promise.reject(new Error("read failed")) };
      }
      if (url === MANIFEST_URL) {
        return response(
          JSON.stringify({
            advisories: [
              {
                id: "critical-update",
                severity: "critical",
                announce: true,
                affects: "<0.6.9",
                title: "Update now",
                message: "Important",
              },
            ],
          }),
        );
      }
      return response("", { status: 404 });
    });

    const result = await releaseDocuments("v0.6.9", fetcher as typeof fetch);

    expect(result.latest?.notes).toBe("");
    expect(result.manifest?.advisories[0]?.id).toBe("critical-update");
  });

  it("keeps changelog notes when manifest parsing fails", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === RELEASE_URL) return response(JSON.stringify({ tag_name: "v0.6.9" }));
      if (url === CHANGELOG_URL) return response("## 0.6.9\n\nStill visible.");
      if (url === MANIFEST_URL) {
        return { ok: true, json: async () => Promise.reject(new Error("bad json")) };
      }
      return response("", { status: 404 });
    });

    const result = await releaseDocuments("v0.6.9", fetcher as typeof fetch);

    expect(result.latest?.notes).toBe("Still visible.");
    expect(result.manifest).toBeNull();
  });

  it("updates a desktop announcement without changing the published release", async () => {
    const notice = { id: "notice", severity: "critical", announce: true, affects: "<0.6.9", title: "Update", message: "Fix available" };
    let modes: string[] | undefined = ["selfhosted"];
    const fetcher = vi.fn(async (url) => String(url) === MANIFEST_URL
      ? Response.json({ advisories: [{ ...notice, ...(modes ? { modes } : {}) }] })
      : new Response("## 0.6.9\n\nUnchanged release notes."));
    const before = await releaseDocuments("v0.6.9", fetcher as typeof fetch);
    expect(findAnnouncement("0.6.8", before.manifest!, "desktop")).toBeNull();
    modes = undefined;
    const after = await releaseDocuments("v0.6.9", fetcher as typeof fetch);
    expect(after.latest).toEqual(before.latest);
    expect(findAnnouncement("0.6.8", after.manifest!, "desktop")?.severity).toBe("critical");
    expect(fetcher.mock.calls.every(([url]) => [MANIFEST_URL, CHANGELOG_URL].includes(String(url)))).toBe(true);
  });

  it("retains a known notice if the live document is malformed", async () => {
    const previous = { advisories: [{ id: "known", severity: "critical" as const, announce: true, affects: "<0.6.9", title: "Update", message: "Fix" }] };
    const fetcher = vi.fn(async (url) => String(url) === MANIFEST_URL
      ? Response.json({ advisories: [{ id: "broken" }] })
      : new Response("## 0.6.9\n\nNotes."));
    const result = await releaseDocuments("v0.6.9", fetcher as typeof fetch, previous);
    expect(result.manifest).toEqual(previous);
    expect(fetcher.mock.calls.some(([url]) => String(url) === TAGGED_MANIFEST_URL)).toBe(false);
  });

  it("uses the tagged fallback on the first check when the live document is unavailable", async () => {
    const fetcher = vi.fn(async (url) => String(url) === MANIFEST_URL
      ? new Response("", { status: 503 })
      : String(url) === TAGGED_MANIFEST_URL ? Response.json({ advisories: [] })
      : new Response("## 0.6.9\n\nNotes."));
    expect((await releaseDocuments("v0.6.9", fetcher as typeof fetch)).manifest).toEqual({ advisories: [] });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("allows the publisher to withdraw a notice with an explicitly empty live document", async () => {
    const previous = { advisories: [{ id: "known", severity: "critical" as const, announce: true, affects: "<0.6.9", title: "Update", message: "Fix" }] };
    const fetcher = vi.fn(async (url) => String(url) === MANIFEST_URL
      ? Response.json({ advisories: [] }) : new Response("## 0.6.9\n\nNotes."));
    expect((await releaseDocuments("v0.6.9", fetcher as typeof fetch, previous)).manifest).toEqual({ advisories: [] });
  });

  it("keeps the known notice while main prepares a release that is not published", async () => {
    const previous = { advisories: [{ id: "published-fix", severity: "critical" as const, announce: true, affects: "<0.6.9", title: "Update", message: "Fix", action: { kind: "update" as const, label: "Update" } }] };
    const fetcher = vi.fn(async (url) => String(url) === MANIFEST_URL
      ? Response.json({ advisories: [{ ...previous.advisories[0], id: "future", affects: "<0.7.0" }] })
      : new Response("## 0.6.9\n\nPublished notes."));
    const result = await releaseDocuments("v0.6.9", fetcher as typeof fetch, previous);
    expect(result.manifest).toEqual(previous);
    expect(result.latest?.version).toBe("0.6.9");
  });

  it("bounds an untrusted chunked document before parsing and retains the known notice", async () => {
    const previous = { advisories: [] };
    const fetcher = vi.fn(async (url) => String(url) === MANIFEST_URL
      ? new Response(new Uint8Array(MAX_RELEASE_ADVISORY_BYTES + 1))
      : new Response("## 0.6.9\n\nNotes."));
    expect((await releaseDocuments("v0.6.9", fetcher as typeof fetch, previous)).manifest).toEqual(previous);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
