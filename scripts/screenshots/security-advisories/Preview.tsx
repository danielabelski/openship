"use client";

import { Logo } from "@/components/logo";
import { RuntimeSecurityNotice } from "@/components/project-settings/RuntimeSecurityNotice";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/Tabs";

/** Real product component; capture.mjs supplies synthetic API responses. */
export default function Preview() {
  return (
    <main className="min-h-screen bg-background p-5 text-foreground sm:p-10">
      <div className="mx-auto max-w-5xl space-y-7" data-security-capture>
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-lg font-medium">
            <Logo size={28} />
            OpenShip
          </div>
          <p className="text-xs text-muted-foreground">Preview · sample application data</p>
        </header>
        <div>
          <p className="mb-3 text-sm text-muted-foreground">
            Projects / Commerce API / Deployments
          </p>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-medium">Commerce API</h1>
              <span className="rounded-full bg-card px-3 py-1 text-xs text-muted-foreground">
                Production
              </span>
            </div>
            <Button variant="secondary">Redeploy</Button>
          </div>
        </div>
        <Tabs
          tabs={[
            { key: "overview", label: "Overview" },
            { key: "deployments", label: "Deployments" },
            { key: "services", label: "Apps & Services" },
          ]}
          value="deployments"
          onChange={() => {}}
        />
        <RuntimeSecurityNotice projectId="security-preview" revision="deployed-preview" />
        <div className="flex items-center justify-between gap-4 rounded-2xl bg-card p-5">
          <div>
            <p className="text-sm font-medium">Current deployment</p>
            <p className="mt-1 text-xs text-muted-foreground">main · api · node:22-alpine</p>
          </div>
          <span className="text-sm text-success">Running</span>
        </div>
      </div>
    </main>
  );
}
