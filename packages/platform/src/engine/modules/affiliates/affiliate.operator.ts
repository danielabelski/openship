import { z } from "zod";
import { AppError, isRecord } from "@repo/contracts";
import type { OblienBillingApi } from "../../lib/oblien-billing-api";
import { affiliateParticipantKey, callAffiliateProvider } from "./affiliate-provider";

const reviewFields = {
  operator: z.string().trim().min(1).max(255),
  reason: z.string().trim().min(1).max(500),
};
export const affiliateOperatorCommand = z.discriminatedUnion("command", [
  z.object({ command: z.literal("show"), offset: z.number().int().min(0).default(0) }).strict(),
  z
    .object({
      command: z.literal("configure"),
      minimumCents: z.number().int().min(100).max(100000000),
      enabled: z.boolean(),
      ...reviewFields,
    })
    .strict(),
  z
    .object({ command: z.enum(["approve", "reject"]), payoutId: z.uuid(), ...reviewFields })
    .strict(),
  z
    .object({
      command: z.literal("paid"),
      payoutId: z.uuid(),
      paymentReference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/),
      ...reviewFields,
    })
    .strict(),
]);
/** Trusted process only. There is deliberately no tenant-facing approval route. */
export async function runAffiliateOperator(
  raw: unknown,
  target: { userId: string; namespace: string; dashboardUrl: string },
  billing: Pick<OblienBillingApi, "affiliateRequest">,
) {
  const input = affiliateOperatorCommand.parse(raw);
  const scope = {
    namespace: target.namespace,
    participantKey: affiliateParticipantKey(target.userId),
  };
  if (input.command === "show") {
    const [overview, payouts] = await Promise.all([
      callAffiliateProvider(billing, scope, target.dashboardUrl, "overview"),
      callAffiliateProvider(billing, scope, target.dashboardUrl, "payouts", {
        limit: 100,
        offset: input.offset,
      }),
    ]);
    return { overview, payouts };
  }
  const path = input.command === "configure" ? "participant" : `payouts/${input.payoutId}/review`;
  const body =
    input.command === "configure"
      ? {
          payoutMinimumCents: input.minimumCents,
          enabled: input.enabled,
          operator: input.operator,
          reason: input.reason,
        }
      : {
          status:
            input.command === "approve"
              ? "processing"
              : input.command === "reject"
                ? "rejected"
                : "paid",
          operator: input.operator,
          reason: input.reason,
          ...(input.command === "paid" ? { paymentReference: input.paymentReference } : {}),
        };
  const result = await billing.affiliateRequest("POST", `/billing/affiliates/reseller/${path}`, {
    ...scope,
    input: body,
  });
  if (
    !isRecord(result) ||
    result.success !== true ||
    !isRecord(result.scope) ||
    result.scope.namespace !== scope.namespace ||
    result.scope.participantKey !== scope.participantKey
  )
    throw new AppError(
      "Affiliate response scope could not be verified",
      502,
      "AFFILIATE_PROVIDER_SCOPE_MISMATCH",
    );
  return result.data;
}
