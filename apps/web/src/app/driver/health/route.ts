import { NextResponse } from "next/server";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

// A thin same-origin proxy to GET /health. The driver's connectivity component
// polls this instead of the API directly so the browser never has to deal with
// CORS and so the check reflects whether the Katapatha reverse proxy is
// reachable, not whether the API host is reachable from a different origin.
export async function GET() {
  try {
    const client = await api();
    const result = await client.GET("/health", {});
    if (result.error || !result.data) {
      return NextResponse.json({ ok: false }, { status: 503 });
    }
    return NextResponse.json({ ok: true, at: result.data.at }, { status: 200 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
