"use client";
import { useCallback, useState } from "react";
import type {
  AffiliateOverview,
  AffiliateOffer,
  AffiliateReferral,
  AffiliatePayout,
} from "@repo/contracts";
import { Icon } from "@repo/ui/icons";
import { useI18n } from "@/components/i18n-provider";
import { PageContainer } from "@/components/ui/PageContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/Tabs";
import { Modal } from "@/components/ui/Modal";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { useScopedResource, useScopedMutation } from "@/hooks/use-scoped-resource";
import { affiliateRequest } from "@/lib/api/affiliates";
import { reportClientError } from "@/lib/error-reporting";
import { randomUUID } from "@/lib/random-uuid";
import { useCloudPlans } from "@/components/billing/useCloudBilling";
import { affiliateDate, affiliateMoney, payoutCents } from "./affiliate-presentation";

const overview = () => affiliateRequest("overview");
const pageSize = 10;
type Tab = "offers" | "referrals" | "payouts";
function useCopy() {
  const { t } = useI18n();
  return t.affiliates;
}
function ErrorMessage({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
      {message}
    </p>
  ) : null;
}
function Status({ value }: { value: string }) {
  const copy = useCopy();
  return (
    <span
      className={`rounded-lg px-2 py-1 text-xs ${["active", "paid", "credited"].includes(value) ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}
    >
      {copy.statuses[value as keyof typeof copy.statuses] ?? value}
    </span>
  );
}

export function AffiliateDashboard() {
  const copy = useCopy(),
    { locale } = useI18n();
  const state = useScopedResource(overview, 60000),
    mutation = useScopedMutation();
  const [tab, setTab] = useState<Tab>("offers"),
    [creating, setCreating] = useState(false),
    [revision, setRevision] = useState(0);
  const refresh = () => {
    state.refresh();
    setRevision((v) => v + 1);
  };
  const data = state.data;
  return (
    <PageContainer className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium">{copy.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{copy.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={refresh} aria-label={copy.refresh}>
            <Icon name="refresh" />
          </Button>
          {data?.available && data.member?.enabled && (
            <Button onClick={() => setCreating(true)}>
              <Icon name="plus" />
              {copy.create}
            </Button>
          )}
        </div>
      </header>
      <ErrorMessage message={state.error || mutation.error} />
      {state.loading ? (
        <p role="status" className="text-muted-foreground">
          {copy.loading}
        </p>
      ) : !data ? (
        <Button variant="secondary" onClick={refresh}>
          {copy.retry}
        </Button>
      ) : !data.available ? (
        <div className="rounded-2xl bg-card p-6 text-muted-foreground">{copy.unavailable}</div>
      ) : !data.member ? (
        <section className="max-w-2xl space-y-5 rounded-2xl bg-card p-6">
          <h2 className="text-xl font-medium">{copy.joinTitle}</h2>
          <p className="text-muted-foreground">{copy.joinHint}</p>
          <p className="text-sm text-muted-foreground">{copy.eligibility}</p>
          <p className="text-sm text-muted-foreground">{copy.rules}</p>
          <div className="space-y-2">
            {data.program.policies.map((policy) => (
              <p key={policy.id} className="text-sm">
                {policy.name} · {policy.commissionBps / 100}% · {policy.durationMonths}{" "}
                {copy.months} · {copy.minimum}: {affiliateMoney(policy.payoutMinimumCents, locale)}
              </p>
            ))}
          </div>
          <Button
            disabled={mutation.busy || !data.program.policies.length}
            onClick={async () => {
              if (await mutation.execute(() => affiliateRequest("enroll"))) refresh();
            }}
          >
            {copy.join}
          </Button>
        </section>
      ) : (
        <>
          {!data.member.enabled && (
            <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">{copy.paused}</p>
          )}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {[
              [copy.available, data.summary.available, copy.adjusted],
              [copy.earned, data.summary.earned, copy.earnedHint],
              [copy.pending, data.summary.reserved, copy.reviewed],
              [copy.paid, data.summary.paid, ""],
            ].map(([label, amount, hint]) => (
              <section key={label} className="rounded-2xl bg-card p-5">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-3 text-2xl font-medium tabular-nums">
                  {affiliateMoney(Number(amount), locale)}
                </p>
                <p className="mt-2 min-h-5 text-xs text-muted-foreground">{hint}</p>
              </section>
            ))}
          </div>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <section className="min-w-0 space-y-4">
              <Tabs<Tab>
                value={tab}
                onChange={setTab}
                idPrefix="affiliates"
                ariaLabel={copy.title}
                tabs={[
                  { key: "offers", label: copy.links, icon: "link" },
                  {
                    key: "referrals",
                    label: copy.customers,
                    icon: "users",
                    count: data.summary.referrals,
                  },
                  { key: "payouts", label: copy.payouts, icon: "credit-card" },
                ]}
              />
              <div
                role="tabpanel"
                id={`affiliates-panel-${tab}`}
                aria-labelledby={`affiliates-tab-${tab}`}
              >
                <Records key={tab} tab={tab} revision={revision} onChanged={refresh} />
              </div>
            </section>
            <PayoutForm data={data} onChanged={refresh} />
          </div>
          <p className="text-xs text-muted-foreground">{copy.eligibility}</p>
          {creating && (
            <CreateLink
              data={data}
              onClose={() => setCreating(false)}
              onCreated={() => {
                setCreating(false);
                setTab("offers");
                refresh();
              }}
            />
          )}
        </>
      )}
    </PageContainer>
  );
}

function PayoutForm({ data, onChanged }: { data: AffiliateOverview; onChanged: () => void }) {
  const copy = useCopy(),
    { locale } = useI18n(),
    mutation = useScopedMutation();
  const [amount, setAmount] = useState(""),
    [key, setKey] = useState(randomUUID);
  const cents = payoutCents(amount),
    minimum = data.member!.payoutMinimumCents;
  const valid =
    !!data.member?.enabled && cents !== null && cents >= minimum && cents <= data.summary.available;
  return (
    <form
      className="space-y-4 rounded-2xl bg-card p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || cents === null) return;
        if (
          await mutation.execute(() =>
            affiliateRequest("requestPayout", { amountCents: cents, idempotencyKey: key }),
          )
        ) {
          setAmount("");
          setKey(randomUUID());
          onChanged();
        }
      }}
    >
      <h2 className="font-medium">{copy.requestTitle}</h2>
      <div className="flex justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{copy.minimum}</span>
        <span>{affiliateMoney(minimum, locale)}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        {data.summary.available < minimum ? copy.minimumHint : copy.requestHint}
      </p>
      <label className="block space-y-2 text-sm">
        <span>{copy.amount}</span>
        <Input
          variant="filled"
          inputMode="decimal"
          value={amount}
          disabled={mutation.busy}
          placeholder={(data.summary.available / 100).toFixed(2)}
          onChange={(e) => {
            setAmount(e.target.value);
            setKey(randomUUID());
          }}
        />
      </label>
      <ErrorMessage message={mutation.error} />
      <Button className="w-full" disabled={!valid || mutation.busy} type="submit">
        {copy.request}
      </Button>
      <p className="text-xs leading-5 text-muted-foreground">{copy.reservedHint}</p>
      {data.summary.available < minimum && (
        <p className="text-xs leading-5 text-muted-foreground">{copy.requestHint}</p>
      )}
    </form>
  );
}

function Records({
  tab,
  revision,
  onChanged,
}: {
  tab: Tab;
  revision: number;
  onChanged: () => void;
}) {
  const copy = useCopy(),
    { locale } = useI18n(),
    mutation = useScopedMutation();
  const [offset, setOffset] = useState(0),
    [revoke, setRevoke] = useState<string | null>(null),
    [customer, setCustomer] = useState<AffiliateReferral | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const fetcher = useCallback(() => {
    void revision;
    return affiliateRequest(tab, { limit: pageSize, offset });
  }, [tab, offset, revision]);
  const state = useScopedResource(fetcher);
  const perform = async (operation: () => Promise<unknown>) => {
    if (await mutation.execute(operation)) {
      setRevoke(null);
      onChanged();
      state.refresh();
    }
  };
  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
    } catch (error) {
      reportClientError(error, { component: "affiliate-clipboard" });
      mutation.setError(copy.copyFailed);
    }
  };
  return (
    <div className="space-y-3">
      <ErrorMessage message={state.error || mutation.error} />
      {state.loading ? (
        <p role="status" className="p-5 text-muted-foreground">
          {copy.loading}
        </p>
      ) : !state.data ? (
        <Button onClick={state.refresh}>{copy.retry}</Button>
      ) : (
        <>
          {state.data.items.length === 0 && (
            <p className="rounded-2xl bg-card p-6 text-sm text-muted-foreground">
              {tab === "offers"
                ? copy.emptyLinks
                : tab === "referrals"
                  ? copy.emptyCustomers
                  : copy.emptyPayouts}
            </p>
          )}
          {state.data.items.map((item) =>
            tab === "offers"
              ? (() => {
                  const link = item as AffiliateOffer;
                  return (
                    <article key={link.id} className="space-y-4 rounded-2xl bg-card p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="font-medium">{link.name}</h3>
                        <Status value={link.status} />
                      </div>
                      <p className="break-all rounded-xl bg-background px-3 py-2 text-sm text-muted-foreground">
                        {link.url}
                      </p>
                      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                        <span>
                          {copy.yourCommission}: {(link.commissionBps - link.discountBps) / 100}%
                        </span>
                        <span>
                          {copy.discount}: {link.discountBps / 100}%
                        </span>
                        <span>
                          {link.durationMonths} {copy.months}
                        </span>
                        <span>
                          {copy.expires}:{" "}
                          {link.expiresAt ? affiliateDate(link.expiresAt, locale) : copy.noExpiry}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void copyValue(link.url)}
                        >
                          {copied === link.url ? copy.copied : copy.copyLink}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void copyValue(link.code)}>
                          {copied === link.code ? copy.copied : copy.copyCode}
                        </Button>
                        {link.status === "active" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={mutation.busy}
                            onClick={() => setRevoke(link.id)}
                          >
                            {copy.revoke}
                          </Button>
                        )}
                      </div>
                      {revoke === link.id && (
                        <div className="space-y-3 rounded-xl bg-background p-4">
                          <p className="text-sm">{copy.revokeHint}</p>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={mutation.busy}
                              onClick={() =>
                                void perform(() => affiliateRequest("revokeOffer", { id: link.id }))
                              }
                            >
                              {copy.confirmRevoke}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={mutation.busy}
                              onClick={() => setRevoke(null)}
                            >
                              {copy.cancel}
                            </Button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })()
              : tab === "referrals"
                ? (() => {
                    const referral = item as AffiliateReferral;
                    return (
                      <article key={referral.id} className="space-y-4 rounded-2xl bg-card p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="font-medium">{referral.customer}</h3>
                          <Status value={referral.status} />
                        </div>
                        <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                          {[
                            [copy.paidThrough, affiliateDate(referral.paidThrough, locale)],
                            [copy.renewal, affiliateDate(referral.nextRenewalAt, locale)],
                            [copy.cycles, referral.paidCycles],
                            [copy.earned, affiliateMoney(referral.earned, locale)],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <dt className="text-xs text-muted-foreground">{label}</dt>
                              <dd className="mt-1">{value}</dd>
                            </div>
                          ))}
                        </dl>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-xs text-muted-foreground">
                            {copy.rewardsUntil}: {affiliateDate(referral.rewardsUntil, locale)}
                          </p>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setCustomer(referral)}
                          >
                            {copy.payments}
                          </Button>
                        </div>
                      </article>
                    );
                  })()
                : (() => {
                    const payout = item as AffiliatePayout;
                    return (
                      <article
                        key={payout.id}
                        className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-card p-5"
                      >
                        <div>
                          <p className="font-medium">
                            {affiliateMoney(payout.amountCents, locale)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {copy.requested}: {affiliateDate(payout.createdAt, locale)}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Status value={payout.status} />
                          {payout.status === "pending" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={mutation.busy}
                              onClick={() =>
                                void perform(() =>
                                  affiliateRequest("cancelPayout", { id: payout.id }),
                                )
                              }
                            >
                              {copy.cancelRequest}
                            </Button>
                          )}
                        </div>
                      </article>
                    );
                  })(),
          )}
          <Pagination total={state.data.total} offset={offset} onChange={setOffset} />
        </>
      )}
      {customer && <PaymentHistory customer={customer} onClose={() => setCustomer(null)} />}
    </div>
  );
}
function Pagination({
  total,
  offset,
  onChange,
}: {
  total: number;
  offset: number;
  onChange: (n: number) => void;
}) {
  const copy = useCopy();
  if (total <= pageSize && offset === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>
        {Math.min(offset + 1, total)}–{Math.min(offset + pageSize, total)} {copy.of} {total}
      </span>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - pageSize))}
        >
          {copy.previous}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={offset + pageSize >= total}
          onClick={() => onChange(offset + pageSize)}
        >
          {copy.next}
        </Button>
      </div>
    </div>
  );
}
function PaymentHistory({
  customer,
  onClose,
}: {
  customer: AffiliateReferral;
  onClose: () => void;
}) {
  const copy = useCopy(),
    { locale } = useI18n();
  const [offset, setOffset] = useState(0);
  const fetcher = useCallback(
    () => affiliateRequest("payments", { id: customer.id, limit: pageSize, offset }),
    [customer.id, offset],
  );
  const state = useScopedResource(fetcher);
  return (
    <Modal isOpen onClose={onClose} width="720px" maxWidth="95vw">
      <div role="dialog" aria-label={copy.payments} className="space-y-5 p-6">
        <div>
          <h2 className="text-lg font-medium">{customer.customer}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.payments}</p>
        </div>
        <ErrorMessage message={state.error} />
        {state.loading ? (
          <p role="status">{copy.loading}</p>
        ) : state.data ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="py-3 text-start font-normal">{copy.payment}</th>
                    <th className="text-start font-normal">{copy.commission}</th>
                    <th className="text-start font-normal">{copy.refunds}</th>
                    <th className="text-start font-normal">{copy.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.items.map((payment) => (
                    <tr key={payment.id} className="border-t border-border/30">
                      <td className="py-3">
                        {affiliateDate(payment.periodStart, locale)}
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {affiliateMoney(payment.paid, locale)}
                        </span>
                      </td>
                      <td>{affiliateMoney(payment.commission, locale)}</td>
                      <td>{affiliateMoney(payment.reversed, locale)}</td>
                      <td>
                        <Status value={payment.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!state.data.items.length && (
              <p className="text-sm text-muted-foreground">{copy.noPayments}</p>
            )}
            <Pagination total={state.data.total} offset={offset} onChange={setOffset} />
          </>
        ) : (
          <Button onClick={state.refresh}>{copy.retry}</Button>
        )}
      </div>
    </Modal>
  );
}

function CreateLink({
  data,
  onClose,
  onCreated,
}: {
  data: AffiliateOverview;
  onClose: () => void;
  onCreated: () => void;
}) {
  const copy = useCopy(),
    mutation = useScopedMutation(),
    catalog = useCloudPlans();
  const [policyId, setPolicy] = useState(data.program.policies[0]?.id ?? ""),
    [name, setName] = useState(""),
    [discount, setDiscount] = useState("0"),
    [plan, setPlan] = useState("all"),
    [expiry, setExpiry] = useState(""),
    [key, setKey] = useState(randomUUID);
  const policy = data.program.policies.find((p) => p.id === policyId),
    bps = Number(discount) * 100;
  const valid =
    !!policy &&
    name.trim().length > 0 &&
    name.trim().length <= 100 &&
    /^\d+(?:\.\d{1,2})?$/.test(discount) &&
    Number.isSafeInteger(bps) &&
    bps >= 0 &&
    bps <= policy.commissionBps &&
    (!expiry || +new Date(expiry) > Date.now());
  const edit = (action: () => void) => {
    action();
    setKey(randomUUID());
  };
  const choices = (catalog.payload?.plans ?? [])
    .filter(
      (p) =>
        p.billingMode === "monthly" &&
        p.resourceLimits?.max_total_vcpus &&
        p.resourceLimits?.max_total_ram_mb &&
        p.resourceLimits?.max_total_disk_gb &&
        p.price.monthly !== null &&
        p.price.monthly >= 1000,
    )
    .map((p) => ({
      value: `vm:${p.resourceLimits!.max_total_vcpus}:${p.resourceLimits!.max_total_ram_mb}:${p.resourceLimits!.max_total_disk_gb}`,
      label: p.name,
    }));
  return (
    <Modal
      isOpen
      onClose={onClose}
      closable={!mutation.busy}
      showCloseButton={!mutation.busy}
      width="560px"
      maxWidth="95vw"
    >
      <form
        role="dialog"
        aria-label={copy.create}
        className="space-y-5 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          if (
            await mutation.execute(() =>
              affiliateRequest("createOffer", {
                policyId,
                name: name.trim(),
                discountBps: bps,
                planId: policy.planId ?? (plan === "all" ? null : plan),
                ...(expiry ? { expiresAt: new Date(expiry).toISOString() } : {}),
                idempotencyKey: key,
              }),
            )
          )
            onCreated();
        }}
      >
        <div>
          <h2 className="text-lg font-medium">{copy.create}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{copy.createHint}</p>
        </div>
        <fieldset disabled={mutation.busy} className="space-y-4">
          <label className="block space-y-2 text-sm">
            <span>{copy.linkName}</span>
            <Input
              variant="filled"
              value={name}
              maxLength={100}
              onChange={(e) => edit(() => setName(e.target.value))}
              required
            />
          </label>
          {data.program.policies.length > 1 && (
            <label className="block space-y-2 text-sm">
              <span>{copy.policy}</span>
              <CustomSelect
                variant="filled"
                triggerClassName="bg-muted/60 hover:bg-muted"
                value={policyId}
                onChange={(value) =>
                  edit(() => {
                    setPolicy(value);
                    setDiscount("0");
                    setPlan("all");
                  })
                }
                options={data.program.policies.map((p) => ({ value: p.id, label: p.name }))}
              />
            </label>
          )}
          {!policy?.planId && (
            <label className="block space-y-2 text-sm">
              <span>{copy.plan}</span>
              <CustomSelect
                variant="filled"
                triggerClassName="bg-muted/60 hover:bg-muted"
                value={plan}
                onChange={(value) => edit(() => setPlan(value))}
                options={[{ value: "all", label: copy.allPlans }, ...choices]}
              />
            </label>
          )}
          <div className="grid grid-cols-2 gap-4">
            <label className="block space-y-2 text-sm">
              <span>{copy.discount} (%)</span>
              <Input
                variant="filled"
                inputMode="decimal"
                value={discount}
                onChange={(e) => edit(() => setDiscount(e.target.value))}
              />
            </label>
            <div className="space-y-2 text-sm">
              <p>{copy.yourCommission}</p>
              <p className="py-2 text-xl font-medium">
                {Math.max(0, (policy?.commissionBps ?? 0) - (Number.isFinite(bps) ? bps : 0)) / 100}
                %
              </p>
            </div>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{copy.budgetHint}</p>
          <label className="block space-y-2 text-sm">
            <span>{copy.expiry}</span>
            <Input
              variant="filled"
              type="datetime-local"
              value={expiry}
              onChange={(e) => edit(() => setExpiry(e.target.value))}
            />
          </label>
        </fieldset>
        <ErrorMessage message={mutation.error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" disabled={mutation.busy} onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button type="submit" disabled={!valid || mutation.busy}>
            {copy.create}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
