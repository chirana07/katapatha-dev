import type { Metadata } from "next";
import { newIdempotencyKey } from "@katapatha/api-client/idempotency";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { readFailure } from "@/lib/failures";
import { ButtonLink } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { OutletLine } from "../store-parts";
import { OrderWizard } from "./order-wizard";

export const metadata: Metadata = { title: "Place an order · Katapatha" };
export const dynamic = "force-dynamic";

export default async function NewStoreOrderPage() {
  await requireRole("STORE_MANAGER", "/store/new");
  const client = await api();
  const [next, limits, products] = await Promise.all([
    client.GET("/reference/calendar/next-operating-day"),
    // Optional: the form only uses it to say "no vehicle can carry this here".
    // The server enforces every size rule.
    client.GET("/orders/limits").catch(() => null),
    // The API already narrows this to the outlet's brand plus every-brand
    // products, and to the active ones.
    client.GET("/products").catch(() => null),
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

  if (!products?.data) {
    const failure = readFailure(products?.response.status ?? 0, "the product list");
    return (
      <PageBody>
        <PageHeader title="Place a new order" />
        <ErrorPanel
          title={failure.title}
          detail="Katapatha could not load the products you can order, so an order can't be started yet."
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
  const productList = products.data;

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
      {productList.length === 0 ? (
        <EmptyState
          title="No products are set up for your outlet yet"
          detail="Ask dispatch to add them."
          action={<ButtonLink href="/store" variant="secondary">Back to Today</ButtonLink>}
        />
      ) : (
      <OrderWizard
        products={productList}
        forDate={forDate}
        requestId={newIdempotencyKey()}
        limits={limits?.data ?? null}
        window={outlet ? { open: outlet.receivingWindowOpen, close: outlet.receivingWindowClose } : null}
        accessNote={outlet?.accessNote ?? null}
      />
      )}
    </PageBody>
  );
}
