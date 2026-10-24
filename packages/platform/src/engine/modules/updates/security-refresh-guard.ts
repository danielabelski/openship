import { isDeepStrictEqual } from "node:util";
import { ValidationError } from "@repo/core";
import { repos, type Project, type Service } from "@repo/db";
import { authorization } from "../../lib/authorization";
import { buildBackgroundContext } from "../../lib/background-context";
import { projectServicesToDeployableServices } from "../deployments/compose/project-services";
import type { DeploymentConfigSnapshot } from "../deployments/build.service";
import { captureSyncedServiceEnvironment } from "../services/service-environment-state";
import { frozenServiceEnvironment } from "../deployments/compose/required-env-preflight";

/** Admission and the worker both fail closed if consent, source release or config changed. */
export async function assertSecurityRefreshConfiguration(
  project: Project | null | undefined,
  snapshot: DeploymentConfigSnapshot,
  capturedServices?: Service[],
) {
  const refresh = snapshot.runtimeSecurityRefresh;
  if (!refresh) return;
  if (!(Date.parse(refresh.expiresAt) > Date.now()))
    throw new ValidationError(
      "The signed security update instruction expired. Check the advisory again.",
    );
  if (!project || project.deletedAt || project.deletionInProgress)
    throw new ValidationError("The project is no longer available for automatic security updates.");
  const policy = await repos.securityAdvisory.project(project.id);
  if (
    !policy?.autoRefresh ||
    policy.approvedBy !== refresh.approvedBy ||
    project.activeDeploymentId !== refresh.deploymentId
  )
    throw new ValidationError(
      "Security refresh consent or active deployment changed. Review this update manually.",
    );
  const actor = buildBackgroundContext({
    userId: refresh.approvedBy,
    organizationId: project.organizationId,
    role: "restricted",
    label: "security:verify-consent",
  });
  if (
    !(await authorization.checkPermissionOnResource(actor, {
      resourceType: "project",
      resourceId: project.id,
      action: "write",
    }))
  )
    throw new ValidationError("Security refresh authorization was revoked.");
  const active = await repos.deployment.findById(refresh.deploymentId);
  if (!active) throw new ValidationError("The original runtime is unavailable.");
  const targets = snapshot.targetServiceIds;
  if (targets?.length !== 1)
    throw new ValidationError("Automatic security refresh requires exactly one image service.");
  const services = (capturedServices ?? (await repos.service.listByProject(project.id))).filter(
    (service) => targets.includes(service.id),
  );
  if (services.length !== targets.length)
    throw new ValidationError("Security refresh services changed.");
  const normalize = (value: unknown) =>
    JSON.parse(JSON.stringify(value, (key, item) => (key === "everDeployed" ? undefined : item)));
  const { buildConfigSnapshot, resolveSnapshotTarget } =
    await import("../deployments/build.service");
  const currentConfig = {
    ...buildConfigSnapshot(project, active.branch ?? undefined),
    ...(await resolveSnapshotTarget(project)),
  };
  const capturedConfig = Object.fromEntries(
    Object.keys(currentConfig).map((key) => [key, snapshot[key as keyof DeploymentConfigSnapshot]]),
  );
  if (!isDeepStrictEqual(normalize(currentConfig), normalize(capturedConfig)))
    throw new ValidationError(
      "Project configuration changed since deployment. Review and deploy saved changes before automatic security updates.",
    );
  for (const service of projectServicesToDeployableServices(services)) {
    const frozen = snapshot.composeServices?.find((item) => item.name === service.name);
    if (!frozen || !isDeepStrictEqual(normalize(service), normalize(frozen)))
      throw new ValidationError(
        "Service configuration changed since deployment. Review and deploy the saved changes before automatic security updates.",
      );
  }
  const envChanges = await repos.project.listEnvVarChangeMeta(project.id, active.environment);
  if (
    envChanges.some(
      (row) =>
        row.updatedAt > active.createdAt &&
        (row.serviceId === null || targets.includes(row.serviceId)),
    )
  )
    throw new ValidationError(
      "Environment settings changed since deployment. Apply them before automatic security updates.",
    );
  // Includes deleted variables and service overrides, which timestamps alone cannot prove.
  const environment = await captureSyncedServiceEnvironment(actor, project.id, targets[0]!);
  const expectedEnvironment = frozenServiceEnvironment(snapshot, targets[0]!);
  if (expectedEnvironment && !isDeepStrictEqual(environment, expectedEnvironment))
    throw new ValidationError(
      "The environment changed after security refresh admission. Review the update manually.",
    );
  return environment;
}
