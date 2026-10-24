import {
  advisoryManifestUrl,
  RELEASE_ADVISORIES_URL,
  type AdvisoryManifest,
  type ReleaseFeedSnapshot,
} from "./types";
import { changelogMarkdownUrl, extractChangelogSection } from "./changelog";
import { parseManifest } from "./advisories";
import { satisfiesRange } from "./semver";
import { reportCaughtError } from "../diagnostics/index";

export const MAX_RELEASE_ADVISORY_BYTES = 128 * 1024;

async function readAdvisoryDocument(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > MAX_RELEASE_ADVISORY_BYTES)
    throw new Error("Release advisory document is too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Release advisory document is empty");
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RELEASE_ADVISORY_BYTES) throw new Error("Release advisory document is too large");
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch((error) =>
      reportCaughtError(error, "core/updates/release-documents.read-cancel"),
    );
  }
  return JSON.parse(text + decoder.decode());
}

/** A platform update notice must point to a release outside its affected range. */
export function parseReleaseAdvisories(raw: unknown, tag: string): AdvisoryManifest {
  const manifest = parseManifest(raw);
  const list = (raw as { advisories?: unknown } | null)?.advisories;
  if (!Array.isArray(list) || manifest.advisories.length !== list.length)
    throw new Error("Invalid release advisory document");
  const version = tag.replace(/^v/, "");
  if (manifest.advisories.some((advisory) =>
    advisory.action?.kind === "update" &&
    (!advisory.target || advisory.target.type === "platform") &&
    satisfiesRange(version, advisory.affects),
  ))
    throw new Error("The fixed version in this announcement is not published yet");
  return manifest;
}

/** Live notices are data; changing them never changes the selected release or installer. */
export async function releaseAdvisories(
  tag: string,
  fetcher: typeof fetch = fetch,
  previous: AdvisoryManifest | null = null,
): Promise<AdvisoryManifest | null> {
  if (!/^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(tag)) throw new Error("Invalid release tag");
  const urls = [RELEASE_ADVISORIES_URL, advisoryManifestUrl(tag)];
  for (let index = 0; index < urls.length; index++) {
    if (index > 0 && previous) return previous;
    try {
      const response = await fetcher(urls[index]!);
      if (!response.ok) continue;
      const raw = await readAdvisoryDocument(response);
      return parseReleaseAdvisories(raw, tag);
    } catch (error) {
      reportCaughtError(error, "core/updates/release-documents.advisories");
    }
  }
  return previous;
}

/** Tagged notes and live notices fail independently. The caller owns caching and credentials. */
export async function releaseDocuments(
  tag: string,
  fetcher: typeof fetch = fetch,
  previousManifest: AdvisoryManifest | null = null,
): Promise<ReleaseFeedSnapshot> {
  if (!/^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(tag)) throw new Error("Invalid release tag");
  const latest = { tag, version: tag.replace(/^v/, ""), notes: "" };
  let manifest: AdvisoryManifest | null = null;
  await Promise.all([
    (async () => {
      try {
        const response = await fetcher(changelogMarkdownUrl(tag));
        if (response.ok)
          latest.notes = extractChangelogSection(await response.text(), latest.version);
      } catch (error) {
        reportCaughtError(error, "core/updates/release-documents.changelog");
        /* The advisory document remains independently usable. */
      }
    })(),
    (async () => {
      manifest = await releaseAdvisories(tag, fetcher, previousManifest);
    })(),
  ]);
  return { latest, manifest };
}
