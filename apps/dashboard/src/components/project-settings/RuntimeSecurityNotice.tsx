"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectSecurityResult } from "@repo/contracts";
import { SECURITY_FEED_SOURCE } from "@repo/core";
import { useI18n } from "@/components/i18n-provider";
import { useCloudResourceKey } from "@/context/CloudResourceContext";
import { useToast } from "@/context/ToastContext";
import { useRuntimeUpdate } from "@/hooks/useRuntimeUpdate";
import { getApiErrorMessage, getApiRequestScopeVersion } from "@/lib/api/client";
import { updatesApi } from "@/lib/api/updates";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/Switch";

/** Same evidence and action on service details and the project's deployment page. */
export function RuntimeSecurityNotice({
  projectId,
  serviceId,
  revision,
  workspaceId,
}: {
  projectId: string;
  serviceId?: string;
  revision?: string | null;
  workspaceId?: string | null;
}) {
  const { t } = useI18n();
  const copy = t.projectSettings.securityAdvisories;
  const { showToast } = useToast();
  const resourceKey = useCloudResourceKey();
  const identity = `${resourceKey}:${projectId}:${revision ?? ""}`;
  const latest = useRef(identity);
  latest.current = identity;
  const [state, setState] = useState<{ identity: string; data: ProjectSecurityResult } | null>(
    null,
  );
  const [policyBusy, setPolicyBusy] = useState(false);
  const [failedIdentity, setFailedIdentity] = useState<string | null>(null);
  const policyGeneration = useRef(0);
  const action = useRuntimeUpdate(projectId, serviceId, workspaceId, revision);
  const [checking, setChecking] = useState(false);
  const requestGeneration = useRef(0);
  const pendingCheck = useRef(false);
  const check = useCallback(
    async (refresh = false) => {
      if (pendingCheck.current || (!refresh && document.visibilityState === "hidden")) return;
      pendingCheck.current = true;
      const request = ++requestGeneration.current;
      const policy = policyGeneration.current;
      const scope = getApiRequestScopeVersion();
      if (refresh) setChecking(true);
      try {
        const { data } = await (refresh
          ? updatesApi.checkSecurity(projectId)
          : updatesApi.security(projectId));
        if (
          request === requestGeneration.current &&
          scope === getApiRequestScopeVersion() &&
          latest.current === identity &&
          policy === policyGeneration.current
        ) {
          setState({ identity, data });
          setFailedIdentity(null);
        }
      } catch (error) {
        if (
          request === requestGeneration.current &&
          scope === getApiRequestScopeVersion() &&
          latest.current === identity
        ) {
          setFailedIdentity(identity);
          if (refresh) showToast(getApiErrorMessage(error), "error");
        }
      } finally {
        if (request === requestGeneration.current) {
          pendingCheck.current = false;
          setChecking(false);
        }
      }
    },
    [identity, projectId, showToast],
  );
  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), 5 * 60_000);
    return () => {
      requestGeneration.current++;
      pendingCheck.current = false;
      clearInterval(timer);
    };
  }, [check]);
  const data = state?.identity === identity ? state.data : null;
  const unavailable = !data || data.feedStale || !!data.feedError || failedIdentity === identity;
  const findings =
    data?.findings.filter((item) => !serviceId || item.serviceId === serviceId) ?? [];
  const changePolicy = async (value: boolean) => {
    policyGeneration.current++;
    const scope = getApiRequestScopeVersion();
    setPolicyBusy(true);
    try {
      const result = await updatesApi.securityPolicy(projectId, value);
      if (latest.current === identity && scope === getApiRequestScopeVersion())
        setState((previous) =>
          previous?.identity === identity
            ? { ...previous, data: { ...previous.data, autoRefresh: result.data.autoRefresh } }
            : previous,
        );
    } catch (error) {
      if (latest.current === identity && scope === getApiRequestScopeVersion())
        showToast(getApiErrorMessage(error), "error");
    } finally {
      setPolicyBusy(false);
    }
  };
  return (
    <details className="rounded-2xl bg-card p-4" open={findings.length > 0 ? true : undefined}>
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        {copy.title}
        {findings.length > 0 && <span className="ms-2 text-warning">{findings.length}</span>}
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          {unavailable ? copy.unavailable : findings.length ? copy.affected : copy.noMatches}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {data?.checkedAt && (
            <p className="text-xs text-muted-foreground">
              {copy.checked}:{" "}
              <time dateTime={data.checkedAt}>{new Date(data.checkedAt).toLocaleString()}</time>
            </p>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={checking || action.updating}
            onClick={() => void check(true)}
          >
            {checking ? copy.checking : copy.checkAgain}
          </Button>
        </div>
        {!!data?.unknownServices.length && (
          <p className="text-xs text-muted-foreground">{copy.partial}</p>
        )}
        {findings.map((finding) => (
          <div
            key={`${finding.id}:${finding.serviceId}`}
            className="space-y-2 rounded-xl bg-card p-4"
          >
            <p className="text-sm font-medium">{finding.title}</p>
            {!serviceId && finding.serviceName && (
              <p className="text-xs text-muted-foreground">{finding.serviceName}</p>
            )}
            {finding.confidence === "possible" && (
              <p className="text-xs text-warning">{copy.possible}</p>
            )}
            <p className="text-sm text-muted-foreground">{finding.message}</p>
            {finding.evidence.map((evidence) => (
              <p key={evidence} className="break-all font-mono text-xs text-muted-foreground">
                {evidence}
              </p>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <a
                className="text-sm underline underline-offset-4"
                href={finding.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {copy.guidance}
              </a>
              {finding.canRefresh && data?.deploymentId && (
                <Button
                  size="sm"
                  disabled={action.updating || unavailable}
                  onClick={() =>
                    void action.applyAdvisory({
                      advisoryId: finding.id,
                      deploymentId: data.deploymentId!,
                      serviceId: finding.serviceId,
                    })
                  }
                >
                  {action.updating
                    ? t.projectSettings.runtimeUpdates.refreshing
                    : t.projectSettings.runtimeUpdates.refresh}
                </Button>
              )}
            </div>
          </div>
        ))}
        {!serviceId && (
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">{copy.automatic}</p>
              <p className="max-w-2xl text-xs text-muted-foreground">{copy.automaticDescription}</p>
            </div>
            <Switch
              checked={data?.autoRefresh ?? false}
              disabled={!data || policyBusy}
              ariaLabel={copy.automatic}
              onChange={(value) => void changePolicy(value)}
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {copy.notifications}{" "}
          <a
            href={SECURITY_FEED_SOURCE}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            {copy.publicFeed}
          </a>
        </p>
      </div>
    </details>
  );
}
