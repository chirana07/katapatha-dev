import Link from "next/link";
import { newIdempotencyKey } from "@katapatha/api-client/idempotency";
import { api } from "@/lib/api";
import { OrderForm } from "./order-form";

export const dynamic = "force-dynamic";

export default async function NewStoreOrderPage() {
  const client = await api();
  const result = await client.GET("/reference/calendar/next-operating-day");

  if (result.error || !result.data) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <Link href="/store" className="inline-flex min-h-11 items-center text-sm font-semibold text-link underline-offset-4 hover:underline">
          Back to orders
        </Link>
        <section className="mt-6 rounded-[var(--radius-card)] bg-red-50 p-5">
          <h1 className="text-xl font-semibold text-critical">Delivery date unavailable</h1>
          <p className="mt-2 text-sm text-muted">
            Katapatha could not confirm the next operating day. Check the connection and try again before placing an order.
          </p>
          <Link
            href="/store/new"
            className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink"
          >
            Try again
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <Link href="/store" className="inline-flex min-h-11 items-center text-sm font-semibold text-link underline-offset-4 hover:underline">
        Back to orders
      </Link>
      <header className="mt-5 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Place an order</h1>
        <p className="mt-2 text-muted">
          Request ambient and chilled goods for the next operating day. Your outlet and brand come from your signed-in account.
        </p>
      </header>
      <OrderForm forDate={result.data.date} requestId={newIdempotencyKey()} />
    </main>
  );
}
