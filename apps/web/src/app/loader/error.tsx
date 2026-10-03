"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { PageBody } from "@/components/ui/page-header";
import { ErrorPanel } from "@/components/ui/states";

/**
 * A render failure in the dock. Load checks are saved one at a time as they are
 * made, so none of them is lost to this; the copy says so because that is the
 * first thing a loader mid-shift wants to know.
 */
export default function LoaderError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageBody>
      <ErrorPanel
        title="The dock could not finish loading this page"
        detail="Any load check you already saved is recorded. Reload the dock before checking more lines."
        outcome="read"
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" onClick={reset}>
              Try again
            </Button>
            <ButtonLink href="/loader">Dock queue</ButtonLink>
          </div>
        }
      />
    </PageBody>
  );
}
