"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorPanel } from "@/components/ui/states";

export default function DriverError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-xl p-4">
      <ErrorPanel
        title="Driver workspace unavailable"
        detail="Katapatha could not finish loading this page. Reload the run and check the stop before you record anything again."
        outcome="read"
        action={
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="primary" onClick={reset} className="min-w-32">
              Try again
            </Button>
            <ButtonLink href="/driver" variant="secondary" className="min-w-32">
              Today&apos;s run
            </ButtonLink>
          </div>
        }
      />
    </main>
  );
}
