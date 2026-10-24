import { readFileSync } from "node:fs";
import { validRange } from "semver";
import { parseReleaseAdvisories, MAX_RELEASE_ADVISORY_BYTES } from "../packages/core/src/updates/release-documents";
import { ADVISORY_MODES } from "../packages/core/src/updates/types";

/** Small data check; no application build, Docker daemon or credentials required. */
export function checkReleaseAdvisories(text: string, tag: string): void {
  if (Buffer.byteLength(text) > MAX_RELEASE_ADVISORY_BYTES) throw new Error("Announcement document exceeds 128 KiB");
  if (!/^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(tag)) throw new Error("Invalid published release version");
  const raw = JSON.parse(text);
  const manifest = parseReleaseAdvisories(raw, tag);
  if (manifest.advisories.length > 100) throw new Error("Too many release notices");
  const ids = new Set<string>();
  for (const [index, advisory] of manifest.advisories.entries()) {
    if (!advisory.id.trim() || ids.has(advisory.id)) throw new Error("Announcement ids must be nonempty and unique");
    ids.add(advisory.id);
    if (!advisory.affects.trim() || !validRange(advisory.affects)) throw new Error("Invalid affected-version range");
    const modes = raw.advisories[index].modes;
    if (modes !== undefined && (!Array.isArray(modes) || modes.length === 0 || modes.some((mode: unknown) => !ADVISORY_MODES.includes(mode as never))))
      throw new Error("Omit modes for all installations, or name supported modes explicitly");
    if (advisory.title.length > 500 || advisory.message.length > 16000) throw new Error("Announcement text is too long");
  }
}

if (import.meta.main) {
  const version = process.argv[2];
  if (!version) throw new Error("Pass the latest published version, e.g. v0.9.5");
  checkReleaseAdvisories(readFileSync(new URL("../release-advisories.json", import.meta.url), "utf8"), version);
  console.log(`Release announcements validated against ${version}; no runtime build required.`);
}
