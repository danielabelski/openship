import { Type, type Static } from "@sinclair/typebox";
import type { ReleaseFeedSnapshot, SecurityManifest } from "@repo/core";
import { CreateDeploymentResultSchema, isCreateDeploymentResult } from "./deployments";
import type {
  ResourceOperationSchema,
  ResourceOperations,
  ScopedOperations,
} from "./resource-operations";
const nullableString = Type.Union([Type.String(), Type.Null()]);
export const AdvisoryFeedResultSchema = Type.Object({
  release: Type.Unsafe<ReleaseFeedSnapshot>({ type: "object" }),
  security: Type.Unsafe<SecurityManifest | null>({ anyOf: [{ type: "object" }, { type: "null" }] }),
  stale: Type.Boolean(),
  checkedAt: nullableString,
  nextCheckAt: nullableString,
  error: nullableString,
});
export const ProjectSecurityResultSchema = Type.Object({
  projectId: Type.String(),
  deploymentId: nullableString,
  checkedAt: nullableString,
  autoRefresh: Type.Boolean(),
  feedStale: Type.Boolean(),
  feedError: nullableString,
  unknownServices: Type.Array(nullableString),
  findings: Type.Array(
    Type.Object({
      id: Type.String(),
      revision: Type.Integer(),
      title: Type.String(),
      message: Type.String(),
      severity: Type.String(),
      url: Type.String(),
      serviceId: nullableString,
      serviceName: nullableString,
      evidence: Type.Array(Type.String()),
      confidence: Type.Union([Type.Literal("confirmed"), Type.Literal("possible")]),
      canRefresh: Type.Boolean(),
    }),
  ),
});
const RuntimeScopeSchema = Type.Object(
  {
    serviceIds: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true }),
    ),
  },
  { additionalProperties: false },
);
export const RuntimeImageCheckResultSchema = Type.Object({
  checkedAt: Type.String(),
  images: Type.Array(
    Type.Object({
      serviceId: nullableString,
      serviceName: nullableString,
      role: Type.Union([Type.Literal("image"), Type.Literal("base")]),
      ref: Type.String(),
      currentDigest: nullableString,
      latestDigest: nullableString,
      status: Type.Union([
        Type.Literal("update_available"),
        Type.Literal("current"),
        Type.Literal("pinned"),
        Type.Literal("unknown"),
      ]),
    }),
  ),
});
export const ProjectUpdateSchema = Type.Object({
  projectId: Type.String(),
  name: Type.String(),
  slug: nullableString,
  isApp: Type.Boolean(),
  appTemplateId: nullableString,
  kind: Type.Union([Type.Literal("commit"), Type.Literal("release"), Type.Literal("image")]),
  behind: Type.Boolean(),
  latestInProgress: Type.Boolean(),
  inProgressDeploymentId: Type.Optional(nullableString),
  currentLabel: nullableString,
  latestLabel: nullableString,
  detail: Type.Record(Type.String(), Type.Unknown()),
  checkedAt: Type.String(),
});
export const UpdateCollectionSchemas = {
  advisories: { action: "read", output: AdvisoryFeedResultSchema },
  list: {
    action: "read",
    input: Type.Object({ behindOnly: Type.Optional(Type.Boolean()) }),
    optionalInput: true,
    output: Type.Array(ProjectUpdateSchema),
  },
  scan: {
    action: "write",
    output: Type.Object({ scanned: Type.Integer(), supported: Type.Integer() }),
  },
} as const satisfies Record<string, ResourceOperationSchema>;
export const UpdateProjectSchemas = {
  security: { action: "read", output: ProjectSecurityResultSchema },
  checkSecurity: { action: "read", output: ProjectSecurityResultSchema },
  securityPolicy: {
    action: "write",
    input: Type.Object({ autoRefresh: Type.Boolean() }, { additionalProperties: false }),
    output: Type.Object({ autoRefresh: Type.Boolean() }),
  },
  applySecurity: {
    action: "write",
    input: Type.Object(
      {
        advisoryId: Type.String({ minLength: 1, maxLength: 100 }),
        deploymentId: Type.String({ minLength: 1 }),
        serviceId: Type.Optional(nullableString),
      },
      { additionalProperties: false },
    ),
    output: CreateDeploymentResultSchema,
    outputCheck: isCreateDeploymentResult,
  },
  apply: {
    action: "write",
    output: CreateDeploymentResultSchema,
    outputCheck: isCreateDeploymentResult,
  },
  updateRuntime: {
    action: "write",
    input: RuntimeScopeSchema,
    optionalInput: true,
    output: CreateDeploymentResultSchema,
    outputCheck: isCreateDeploymentResult,
  },
  checkRuntime: {
    action: "read",
    input: RuntimeScopeSchema,
    optionalInput: true,
    output: RuntimeImageCheckResultSchema,
  },
} as const satisfies Record<string, ResourceOperationSchema>;
export type ProjectUpdate = Static<typeof ProjectUpdateSchema>;
export type ProjectSecurityResult = Static<typeof ProjectSecurityResultSchema>;
export type AdvisoryFeedResult = Static<typeof AdvisoryFeedResultSchema>;
export type ApplySecurityInput = Static<typeof UpdateProjectSchemas.applySecurity.input>;
export type UpdateRuntimeInput = Static<typeof UpdateProjectSchemas.updateRuntime.input>;
export type RuntimeImageCheckResult = Static<typeof RuntimeImageCheckResultSchema>;
export interface UpdateOperations
  extends
    ScopedOperations<typeof UpdateCollectionSchemas>,
    ResourceOperations<typeof UpdateProjectSchemas> {}
