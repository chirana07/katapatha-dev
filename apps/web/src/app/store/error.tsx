"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { PageBody } from "@/components/ui/page-header";
import { ErrorPanel } from "@/components/ui/states";

/**
 * The route's last resort. An action that threw may still have been applied, so
 * this says to check the lists before trying it again.
 */
export default function StoreError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageBody>
      <ErrorPanel
        title="This page could not finish loading"
        detail="If you were placing an order or confirming a receipt, check My orders before trying again."
        outcome="unknown"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={reset}>Try again</Button>
            <ButtonLink href="/store/orders">Check my orders</ButtonLink>
          </div>
        }
      />
    </PageBody>
  );
}
