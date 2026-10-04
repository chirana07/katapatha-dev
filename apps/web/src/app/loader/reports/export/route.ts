import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { dateParam } from "@/lib/dates";

/**
 * "Download shift report" (L-06): the day's vehicle log as CSV, from the same
 * dock shift the Reports page reads. The API checks the session, so this is a
 * signed-in loader's own depot or nothing.
 */
export async function GET(request: Request) {
  const date = dateParam(new URL(request.url).searchParams.get("date") ?? undefined);
  const client = await api();
  const [shift, trips] = await Promise.all([
    client.GET("/dock/shift", { params: { query: { date } } }).catch(() => null),
    client.GET("/trips", { params: { query: { date } } }).catch(() => null),
  ]);
  if (!shift?.data || !trips?.data) {
    return new NextResponse("The shift could not be read. Sign in again and retry.", { status: shift?.response.status ?? 502 });
  }
  const tripOf = new Map(trips.data.map((t) => [t.id, t]));
  const clock = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) : "";
  const cell = (value: string | number | null | undefined) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = [
    ["Vehicle", "Trip", "Route", "Bay", "Departs", "Status", "Started", "Sealed", "Load minutes", "Units loaded", "Units ordered", "Sealed on time", "Minutes late"],
    ...shift.data.trips.map((t) => [
      t.vehicleId,
      t.tripNo,
      tripOf.get(t.tripId)?.districtName ?? "",
      t.dockBay ?? "",
      t.plannedDepartAt ?? "",
      t.status,
      clock(t.loadStartedAt),
      clock(t.sealedAt),
      t.loadMinutes ?? "",
      t.loadedUnits,
      t.expectedUnits,
      t.sealedOnTime == null ? "" : t.sealedOnTime ? "yes" : "no",
      t.lateMinutes ?? "",
    ]),
  ];
  const body = rows.map((row) => row.map(cell).join(",")).join("\n") + "\n";
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="shift-report-${shift.data.depotCode}-${date}.csv"`,
    },
  });
}
