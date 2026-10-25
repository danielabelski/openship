/** Run only inside the trusted Cloud API environment; never opens the live embedded database. */
import { parseArgs } from "node:util";
import { userInfo } from "node:os";
import { createDatabase, createRepositories } from "@repo/db/factory";
import { AppError } from "@repo/contracts";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean" },
      email: { type: "string" },
      "minimum-cents": { type: "string" },
      enabled: { type: "string" },
      payout: { type: "string" },
      reference: { type: "string" },
      operator: { type: "string" },
      reason: { type: "string" },
      offset: { type: "string" },
    },
  });
  if (values.help || !positionals.length) {
    console.log(`Affiliate administration. Run on the Cloud API with its normal environment.
  bun run affiliate show --email person@example.com [--offset 0]
  bun run affiliate configure --email person@example.com --minimum-cents 5000 --enabled true --reason "Approved terms"
  bun run affiliate approve --email person@example.com --payout <id> --reason "Verified recipient and earnings"
  bun run affiliate reject --email person@example.com --payout <id> --reason "Purchase refunded"
  bun run affiliate paid --email person@example.com --payout <id> --reference <bank-transfer-id> --reason "Transfer completed"
Approve reserves the request for manual payment. This command never sends money.
Use paid only to record a completed external transfer. Never pay a pending or rejected request.
An operator identity is recorded (defaults to the current OS user).`);
    return;
  }
  if (positionals.length !== 1 || !values.email)
    throw new AppError("One command and --email are required", 400, "USAGE");
  if (
    process.env.CLOUD_MODE !== "true" ||
    !process.env.DATABASE_URL ||
    !process.env.OBLIEN_CLIENT_ID ||
    !process.env.OBLIEN_CLIENT_SECRET
  )
    throw new AppError(
      "Run in the Cloud API environment with PostgreSQL and Oblien credentials configured",
      400,
      "CONFIGURATION",
    );
  const { env, runtimeTarget } = await import("@repo/platform/engine/config/env");
  const { getOblienBillingApi } = await import("@repo/platform/engine/lib/oblien-client");
  const { runAffiliateOperator } =
    await import("@repo/platform/engine/modules/affiliates/affiliate.operator");
  const command = positionals[0];
  const input =
    command === "show"
      ? { command, offset: Number(values.offset ?? 0) }
      : {
          command,
          operator: values.operator || userInfo().username,
          reason: values.reason,
          ...(command === "configure"
            ? {
                minimumCents: Number(values["minimum-cents"]),
                enabled:
                  values.enabled === "true" ? true : values.enabled === "false" ? false : undefined,
              }
            : {
                payoutId: values.payout,
                ...(command === "paid" ? { paymentReference: values.reference } : {}),
              }),
        };
  const connection = await createDatabase({
    driver: "pg",
    url: process.env.DATABASE_URL,
    migrations: "verify",
    poolMax: 2,
    connectTimeoutMs: 5000,
  });
  try {
    const account = await createRepositories(connection.db).user.findByEmail(values.email.trim());
    if (!account || account.email.toLowerCase() !== values.email.trim().toLowerCase())
      throw new AppError("Account not found", 404, "ACCOUNT_NOT_FOUND");
    console.log(
      JSON.stringify(
        await runAffiliateOperator(
          input,
          {
            userId: account.id,
            namespace: env.OBLIEN_AFFILIATE_NAMESPACE,
            dashboardUrl: runtimeTarget.dashboard,
          },
          getOblienBillingApi(),
        ),
        null,
        2,
      ),
    );
  } finally {
    await connection.close();
  }
}
main().catch((error) => {
  console.error(
    error instanceof AppError
      ? `${error.code}: ${error.message}`
      : "Affiliate command failed. Check command arguments, the account and provider status. No payment was sent.",
  );
  process.exitCode = 1;
});
