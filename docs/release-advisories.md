# Release announcements

Edit `release-advisories.json` on `main` to change an announcement's severity,
message, affected versions or audience. Omit `modes` to include Desktop,
self-hosted and Cloud. Set `severity: "critical"` and `announce: true` for an
urgent prompt. Keep the same `id` for corrections; use a new id for a new notice.

An announcement-only commit runs the **Release advisories** data check instead
of application CI. It does not build images, installers or npm packages, move
release tags, or replace published artifacts. Pull requests and application
changes keep their normal checks. Validate locally with:

```sh
bun scripts/check-release-advisories.ts v0.9.5
bun test scripts/check-release-advisories.test.ts
```

Updaters read the live document at their existing polling interval. Manual
**Check for updates** refreshes Desktop immediately. A GitHub release `304`
does not suppress notice refreshes. Failed or malformed live data retains the
last valid notice, with the tagged document as a first-use fallback. Changelog
notes, version selection, installer checksums and signatures stay release-bound.
An update notice cannot recommend a binary release that has not been published.
Runtime security advisories continue using their separate signed feed.

Versions through 0.9.5 read the tagged announcement only. Those installations
need one application update before live announcement changes can reach them;
changing `main` cannot retroactively change the URL compiled into an old client.
