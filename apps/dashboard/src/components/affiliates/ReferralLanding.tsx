"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { affiliateMoney } from "./affiliate-presentation";
import { getReferralOffer } from "@/lib/api/affiliates";
import { getApiErrorMessage } from "@/lib/api/client";
import type { AffiliatePublicOffer } from "@repo/contracts";

export function ReferralLanding({ code }: { code: string }) {
  const { t } = useI18n(),
    copy = t.affiliates;
  const [state, setState] = useState<{ offer?: AffiliatePublicOffer; error?: string }>({});
  const load = useCallback(async () => {
    try {
      return { offer: await getReferralOffer(code) };
    } catch (e) {
      return { error: getApiErrorMessage(e) };
    }
  }, [code]);
  useEffect(() => {
    let active = true;
    setState({});
    void load().then((result) => {
      if (active) setState(result);
    });
    return () => {
      active = false;
    };
  }, [load]);
  const destination = `/billing/plans${state.offer ? `?ref=${encodeURIComponent(state.offer.code)}` : ""}`;
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="w-full max-w-xl space-y-6 rounded-2xl bg-card p-8">
        <Link href="/" className="text-sm font-medium">
          OpenShip
        </Link>
        <h1 className="text-3xl font-medium">{copy.referralTitle}</h1>
        {state.offer ? (
          <>
            <p className="text-xl">
              {state.offer.discountBps / 100}% {copy.discount.toLowerCase()} ·{" "}
              {state.offer.durationMonths} {copy.months}
            </p>
            <p className="font-mono text-sm text-muted-foreground">{state.offer.code}</p>
            <p className="text-sm text-muted-foreground">
              {copy.eligibility} {affiliateMoney(state.offer.minimumMonthlyCents)} / mo.
            </p>
            <p className="text-sm text-muted-foreground">{copy.referralHint}</p>
          </>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {state.error ? copy.referralUnavailable : copy.verifying}
          </p>
        )}
        {state.offer || state.error ? (
          <Button asChild>
            <Link href={`/register?${new URLSearchParams({ returnTo: destination })}`}>
              {copy.continue}
            </Link>
          </Button>
        ) : (
          <Button disabled>{copy.continue}</Button>
        )}
      </section>
    </main>
  );
}
