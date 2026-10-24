"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@repo/ui/icons";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

/** Product navigation, separate from the selected subscription's billing tabs. */
export function BillingProductSwitch() {
  const pathname = usePathname();
  const { t } = useI18n();
  const selected = pathname.endsWith("/manage") ? "manage" : "cloud";
  const products = [
    {
      key: "cloud",
      icon: "cloud",
      href: "/billing/overview",
      title: t.billing.home.label,
      description: t.billing.products.cloudDescription,
    },
    {
      key: "manage",
      icon: "server",
      href: "/billing/manage",
      title: "Openship Manage",
      description: t.billing.products.manageDescription,
    },
  ] as const;

  return (
    <nav
      aria-label={t.billing.products.label}
      className="@container/billing-products w-full max-w-md"
    >
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-muted/60 p-1">
        {products.map(({ key, icon, href, title, description }) => {
          const active = key === selected;
          return (
            <Link
              key={key}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-0 items-center gap-3 rounded-xl px-2 py-2.5 text-start transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring @[26rem]/billing-products:px-3",
                active
                  ? "bg-card text-foreground shadow-sm ring-1 ring-border/40"
                  : "text-muted-foreground hover:bg-card/50 hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "hidden size-8 shrink-0 items-center justify-center rounded-lg @[26rem]/billing-products:flex",
                  active ? "bg-muted/70" : "bg-muted/40",
                )}
              >
                <Icon name={icon} className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-5">{title}</span>
                <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                  {description}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
