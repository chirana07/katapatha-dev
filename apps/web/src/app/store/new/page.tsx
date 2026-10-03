import type { Metadata } from "next";
import { newIdempotencyKey } from "@katapatha/api-client/idempotency";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { readFailure } from "@/lib/failures";
import { ButtonLink } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { ErrorPanel } from "@/components/ui/states";
import { OutletLine } from "../store-parts";
import { OrderWizard } from "./order-wizard";

export const metadata: Metadata = { title: "Place an order · Katapatha" };
export const dynamic = "force-dynamic";

export default async function NewStoreOrderPage() {
  await requireRole("STORE_MANAGER", "/store/new");
  const client = await api();
  const [next, limits] = await Promise.all([
    client.GET("/reference/calendar/next-operating-day"),
    // Optional: the form only uses it to preview size. The server enforces it.
    client.GET("/orders/limits").catch(() => null),
  ]);

  if (next.error || !next.data) {
    const failure = readFailure(next.response.status, "the next delivery day");
    return (
      <PageBody>
        <PageHeader title="Place a new order" />
        <ErrorPanel
          title={failure.title}
          detail="Katapatha could not confirm the next operating day, so an order can't be placed yet. Check the connection and try again."
          outcome="read"
          action={<ButtonLink href="/store/new" variant="primary">Try again</ButtonLink>}
        />
      </PageBody>
    );
  }

  const forDate = next.data.date;
  // The receiving window and outlet line for the day the order is for.
  const day = await client.GET("/store/today", { params: { query: { date: forDate } } }).catch(() => null);
  const outlet = day?.data ?? null;

  return (
    <PageBody>
      <div>
        <PageHeader title="Place a new order" />
        {outlet ? (
          <OutletLine
            outletId={outlet.outletId}
            name={outlet.outletName}
            brand={outlet.brand}
            window={{ open: outlet.receivingWindowOpen, close: outlet.receivingWindowClose }}
          />
        ) : null}
      </div>
      <OrderWizard
        forDate={forDate}
        requestId={newIdempotencyKey()}
        limits={limits?.data ?? null}
        window={outlet ? { open: outlet.receivingWindowOpen, close: outlet.receivingWindowClose } : null}
        accessNote={outlet?.accessNote ?? null}
      />
    </PageBody>
  );
}
