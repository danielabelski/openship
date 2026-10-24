"use client";

/**
 * Update + advisory state for the dashboard (desktop AND self-hosted).
 *
 * The backend caches tagged releases and the separately signed security feed.
 * Nothing in either feed executes remote instructions. Pure resolution lives
 * in @repo/core; this hook only does I/O + preference persistence.
 */

import { reportCaughtError as observeCaughtError } from "@repo/core/diagnostics";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  parseManifest,
  resolveUpdateState,
  matchAdvisories,
  type AdvisoryMode,
  compareSemver,
  type AdvisoryManifest,
  type LatestRelease,
  type ReleaseFeedSnapshot,
  type UpdateState,
} from "@repo/core";
import { useDeploymentInfo } from "@/hooks/useDeploymentInfo";
import { updatesApi } from "@/lib/api/updates";
import { getRestApiBaseUrl } from "@/lib/api/urls";

const LS_MUTED = "openship_update_muted";
const LS_DISMISSED = "openship_dismissed_advisories";
const LS_LAST_SEEN = "openship_last_seen_version";

// The header and Settings can both consume this hook. A dismissal belongs to
// the app session, so a remount or an in-flight refresh must not undo it.
const EMPTY_DISMISSALS: ReadonlySet<string> = new Set();
let sessionDismissals = EMPTY_DISMISSALS;
const dismissalListeners = new Set<() => void>();
const getSessionDismissals = () => sessionDismissals;
const getServerDismissals = () => EMPTY_DISMISSALS;
function subscribeDismissals(listener: () => void) {
  dismissalListeners.add(listener);
  return () => { dismissalListeners.delete(listener); };
}

function isDesktop(): boolean {
  return typeof window !== "undefined" && !!window.desktop?.isDesktop;
}

interface Prefs {
  muted: boolean;
  dismissed: string[];
  lastSeen: string | null;
}

/** Prefs live in the desktop config store (native app) or localStorage (web). */
async function getPrefs(): Promise<Prefs> {
  const cfg = isDesktop() ? window.desktop?.config : undefined;
  if (cfg) {
    const notif = await cfg.get<boolean | undefined>("updateNotifications").catch((diagnosticFailure) => { observeCaughtError(diagnosticFailure, "dashboard/components/updates/useUpdates"); return undefined; });
    const dismissed = (await cfg.get<string[] | undefined>("dismissedAdvisoryIds").catch((diagnosticFailure) => { observeCaughtError(diagnosticFailure, "dashboard/components/updates/useUpdates"); return undefined; })) ?? [];
    const lastSeen = (await cfg.get<string | undefined>("lastSeenVersion").catch((diagnosticFailure) => { observeCaughtError(diagnosticFailure, "dashboard/components/updates/useUpdates"); return undefined; })) ?? null;
    return { muted: notif === false, dismissed, lastSeen };
  }
  let dismissed: string[] = [];
  try {
    dismissed = JSON.parse(localStorage.getItem(LS_DISMISSED) ?? "[]");
  } catch {
    dismissed = [];
  }
  return {
    muted: localStorage.getItem(LS_MUTED) === "1",
    dismissed,
    lastSeen: localStorage.getItem(LS_LAST_SEEN),
  };
}

async function persistMuted(muted: boolean): Promise<void> {
  const cfg = isDesktop() ? window.desktop?.config : undefined;
  if (cfg) await cfg.set("updateNotifications", !muted);
  else localStorage.setItem(LS_MUTED, muted ? "1" : "0");
}

async function persistDismissed(id: string): Promise<void> {
  const cfg = isDesktop() ? window.desktop?.config : undefined;
  if (cfg) {
    const cur = (await cfg.get<string[] | undefined>("dismissedAdvisoryIds").catch((diagnosticFailure) => { observeCaughtError(diagnosticFailure, "dashboard/components/updates/useUpdates"); return undefined; })) ?? [];
    if (!cur.includes(id)) await cfg.set("dismissedAdvisoryIds", [...cur, id]);
    return;
  }
  let cur: string[] = [];
  try {
    cur = JSON.parse(localStorage.getItem(LS_DISMISSED) ?? "[]");
  } catch {
    cur = [];
  }
  if (!cur.includes(id)) localStorage.setItem(LS_DISMISSED, JSON.stringify([...cur, id]));
}

async function persistLastSeen(version: string): Promise<void> {
  const cfg = isDesktop() ? window.desktop?.config : undefined;
  if (cfg) await cfg.set("lastSeenVersion", version);
  else localStorage.setItem(LS_LAST_SEEN, version);
}

// Coalesce dashboard consumers. The backend owns the GitHub cache and cadence.
let remoteCache: Promise<ReleaseFeedSnapshot> | null = null;
let remoteCheckedAt = 0;
let remoteInFlight: Promise<ReleaseFeedSnapshot> | null = null;

function fetchRemote(force = false): Promise<ReleaseFeedSnapshot> {
  if (remoteInFlight) return remoteInFlight;
  if (!force && remoteCache && Date.now() - remoteCheckedAt < 5 * 60_000) return remoteCache;
  // The backend coalesces browsers, tenants and scheduler ticks, keeps credentials
  // server-side, and enforces the GitHub cadence even for manual refreshes.
  const previous = remoteCache;
  const request: Promise<ReleaseFeedSnapshot> = updatesApi.advisories().then(({ data }) => {
    remoteCheckedAt = Date.now();
    const securityAdvisories = (data.security?.advisories ?? []).flatMap((notice) =>
      notice.targets.filter((target) => target.kind === "platform").map((target) => ({
        id: `security:${notice.id}:${notice.revision}`, title: notice.title, message: notice.message,
        severity: notice.severity === "critical" || notice.severity === "high" ? "critical" as const : "recommended" as const,
        announce: true, affects: target.affected,
        action: { kind: "open-url" as const, label: "Read advisory", url: notice.url },
      })));
    return { ...data.release, manifest: { advisories: [...(data.release.manifest?.advisories ?? []), ...securityAdvisories] } };
  }).catch((error) => {
    observeCaughtError(error, "dashboard/components/updates/useUpdates");
    return previous ?? { latest: null, manifest: null };
  });
  remoteInFlight = request.finally(() => { remoteInFlight = null; });
  remoteCache = remoteInFlight;
  return remoteInFlight;
}

// The SaaS advisory source: operator-pushed platform notices from our own API
// (partial outage, maintenance, upgrade advisories), returned in the SAME
// manifest shape as the GitHub advisory feed so the shared banner renders both
// identically. Same-origin on the SaaS; never throws (offline → no notices).
async function fetchNotices(): Promise<AdvisoryManifest> {
  try {
    const res = await fetch(`${getRestApiBaseUrl()}/notices`, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!res.ok) return { advisories: [] };
    return parseManifest(await res.json());
  } catch (diagnosticFailure) {
    observeCaughtError(diagnosticFailure, "dashboard/components/updates/useUpdates");
    return { advisories: [] };
  }
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, recommended: 1, info: 2 };

/** Where the in-app download/install is in its lifecycle (desktop only). */
export type UpdatePhase = "idle" | "downloading" | "installing" | "error";

export interface UseUpdates {
  state: UpdateState | null;
  latest: LatestRelease | null;
  muted: boolean;
  desktop: boolean;
  /**
   * Which install this is — the same value advisories are filtered on. Surfaces
   * need it to offer the RIGHT action: desktop drives the native updater,
   * self-hosted has to run the CLI on the host, cloud has nothing to update.
   * "cloud" until deployment info loads, so nothing suggests a wrong action.
   */
  mode: AdvisoryMode;
  /** The version to celebrate in a "what's new" notice, or null. */
  whatsNewVersion: string | null;
  dismissAdvisory: (id: string) => void;
  dismissWhatsNew: () => void;
  setMuted: (muted: boolean) => void;
  /** Desktop: open the native updater window for the pending update. */
  startDesktopUpdate: () => void;
  /** Desktop: start the download in-place and stream progress into the header
   *  (no native modal). Falls back to the native offer if nothing is pending. */
  beginUpdate: () => void;
  /** Download/install lifecycle for the inline header progress bar. */
  updatePhase: UpdatePhase;
  /** Download fraction 0..1 (meaningful while `updatePhase === "downloading"`). */
  updateProgress: number;
  /** Error message when `updatePhase === "error"`. */
  updateError: string | null;
  reload: () => void;
  /** Refresh from the backend, preserving its GitHub cadence and backoff. */
  refresh: () => void;
}

export function useUpdates(): UseUpdates {
  const deployInfo = useDeploymentInfo();
  const dismissed = useSyncExternalStore(subscribeDismissals, getSessionDismissals, getServerDismissals);
  const [state, setState] = useState<UpdateState | null>(null);
  const [latest, setLatest] = useState<LatestRelease | null>(null);
  const [muted, setMutedState] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [whatsNewVersion, setWhatsNewVersion] = useState<string | null>(null);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>("idle");
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Which install is this? Mode-targeted advisories are filtered on it, so a
  // desktop-installer notice never reaches a VPS dashboard and an edge/compose
  // notice never reaches the desktop app. Desktop wins over selfHosted: the
  // Electron app reports selfHosted too, but it updates through its own
  // installer, not by the operator upgrading a server.
  const mode: AdvisoryMode = isDesktop()
    ? "desktop"
    : deployInfo?.selfHosted
      ? "selfhosted"
      : "cloud";

  const load = useCallback(async () => {
    // Desktop + self-hosted operators control their own install → the GitHub
    // update + advisory feed below. The managed SaaS (cloud) has nothing to
    // self-update, but still surfaces OPERATOR-pushed platform notices (partial
    // outage, maintenance, advisories) through the SAME advisory banner —
    // different source (our /api/notices), identical shape + dismissal rules.
    const desktopOrSelfHosted = isDesktop() || deployInfo?.selfHosted === true;
    if (!desktopOrSelfHosted) {
      if (!deployInfo) return; // deploy info still loading — not yet known to be cloud
      const [prefs, notices] = await Promise.all([getPrefs(), fetchNotices()]);
      setMutedState(prefs.muted);
      const advisories = matchAdvisories(deployInfo.version ?? "", notices, mode)
        .filter((a) => a.severity === "critical" || (!prefs.muted && !prefs.dismissed.includes(a.id)))
        .sort((x, y) => (SEVERITY_RANK[x.severity] ?? 9) - (SEVERITY_RANK[y.severity] ?? 9));
      setState({
        currentVersion: deployInfo.version ?? "",
        latestVersion: null,
        updateAvailable: false,
        advisories,
        changelogUrl: "",
        latestChangelogUrl: "",
      });
      return;
    }

    let current: string | null = null;
    if (isDesktop() && window.desktop?.app) {
      current = await window.desktop.app.version().catch((diagnosticFailure) => { observeCaughtError(diagnosticFailure, "dashboard/components/updates/useUpdates"); return null; });
    } else {
      current = deployInfo?.version ?? null;
    }
    if (!current) return;
    setCurrentVersion(current);

    // Also pull operator-pushed platform notices here (not just on cloud) so a
    // self-hosted/desktop operator sees danger/maintenance advisories through
    // the SAME banner. Merge them with the GitHub release advisories.
    const [prefs, remote, notices] = await Promise.all([
      getPrefs(),
      fetchRemote(),
      fetchNotices().catch((diagnosticFailure) => { observeCaughtError(diagnosticFailure, "dashboard/components/updates/useUpdates"); return ({ advisories: [] }); }),
    ]);
    setMutedState(prefs.muted);
    setLatest(remote.latest);
    const base = resolveUpdateState({
      currentVersion: current,
      latestRelease: remote.latest,
      manifest: remote.manifest,
      dismissed: prefs.dismissed,
      muted: prefs.muted,
      mode,
    });
    const noticeAdvisories = matchAdvisories(current, notices, mode).filter(
      (a) => a.severity === "critical" || (!prefs.muted && !prefs.dismissed.includes(a.id)),
    );
    const advisories = [...base.advisories, ...noticeAdvisories]
      .filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i)
      .sort((x, y) => (SEVERITY_RANK[x.severity] ?? 9) - (SEVERITY_RANK[y.severity] ?? 9));
    setState({ ...base, advisories });

    // "What's new": show once when the running version is newer than the last
    // version we announced. First run (no record) just seeds the baseline.
    if (prefs.lastSeen === null) {
      await persistLastSeen(current);
    } else if (compareSemver(current, prefs.lastSeen) > 0) {
      setWhatsNewVersion(current);
    }
  }, [deployInfo?.version, deployInfo?.selfHosted, mode]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState !== "hidden") void load(); }, 5 * 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const dismissAdvisory = useCallback(
    (id: string) => {
      const adv = state?.advisories.find((a) => a.id === id);
      if (!adv || sessionDismissals.has(id)) return;
      sessionDismissals = new Set([...sessionDismissals, id]);
      for (const listener of dismissalListeners) listener();
      // Critical advisories are session-dismiss only (they resurface next launch
      // by design); everything else is remembered so it never nags again.
      // Keep the session choice even if the persistent store is unavailable.
      if (adv.severity !== "critical") void persistDismissed(id).catch((diagnosticFailure) => {
        observeCaughtError(diagnosticFailure, "dashboard/components/updates/useUpdates");
      });
    },
    [state],
  );

  const dismissWhatsNew = useCallback(() => {
    if (currentVersion) void persistLastSeen(currentVersion);
    setWhatsNewVersion(null);
  }, [currentVersion]);

  const setMuted = useCallback(
    (m: boolean) => {
      setMutedState(m);
      void persistMuted(m).then(() => load());
    },
    [load],
  );

  // Stream the native updater's download/install progress into the header bar.
  // The main process broadcasts these to the main window once a download starts
  // (from the native modal's "Update now" OR an in-place beginUpdate()).
  useEffect(() => {
    const u = typeof window !== "undefined" ? window.desktop?.updates : undefined;
    if (!u) return;
    const offProgress = u.onProgress?.((f) => {
      setUpdatePhase("downloading");
      setUpdateProgress(f);
    });
    const offDone = u.onDone?.(() => {
      setUpdatePhase("installing");
      setUpdateProgress(1);
    });
    const offError = u.onError?.((msg) => {
      setUpdatePhase("error");
      setUpdateError(msg || null);
    });
    return () => {
      offProgress?.();
      offDone?.();
      offError?.();
    };
  }, []);

  const startDesktopUpdate = useCallback(() => {
    void window.desktop?.updates?.open?.();
  }, []);

  // Download in-place: show the inline bar immediately, then kick the main
  // process. If nothing is pending there (start() → false), drop the inline
  // state and fall back to the native offer so the click is never a dead end.
  const beginUpdate = useCallback(() => {
    const u = typeof window !== "undefined" ? window.desktop?.updates : undefined;
    if (!u?.start) return;
    setUpdateError(null);
    setUpdateProgress(0);
    setUpdatePhase("downloading");
    void Promise.resolve(u.check?.(true)).then(() => u.start())
      .then((ok) => {
        if (ok === false) {
          setUpdatePhase("idle");
          void u.open?.();
        }
      })
      .catch((diagnosticFailure) => { observeCaughtError(diagnosticFailure, "dashboard/components/updates/useUpdates"); return setUpdatePhase("idle"); });
  }, []);

  // Concurrent consumers join the backend read. The native installer separately
  // verifies the matching release artifact before installing it.
  const refresh = useCallback(() => {
    void fetchRemote(true);
    void load();
  }, [load]);

  return {
    state: state ? { ...state, advisories: state.advisories.filter((a) => !dismissed.has(a.id)) } : null,
    latest,
    muted,
    desktop: isDesktop(),
    mode,
    whatsNewVersion,
    dismissAdvisory,
    dismissWhatsNew,
    setMuted,
    startDesktopUpdate,
    beginUpdate,
    updatePhase,
    updateProgress,
    updateError,
    reload: load,
    refresh,
  };
}
