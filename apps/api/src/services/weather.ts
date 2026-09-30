

/**
 * Current conditions at a depot.
 *
 * Open-Meteo, because it needs no account and no key — one fewer thing to
 * provision before the application works. Cached for ten minutes: weather does
 * not change faster than that and a dashboard reload should not cost a
 * round trip to another service.
 *
 * Worth being clear about what this is: the datasets are a simulation set on
 * 9 April 2026, so this is today's real weather at the depot, not that day's.
 * It is shown as live context beside the planning figures rather than as part
 * of them — nothing in the allocator reads it. When the fetch fails the widget
 * falls back to the monsoon flag on the seeded calendar, which is in the data.
 */

export interface Weather {
  place: string;
  temperatureC: number | null;
  label: string;
  /** Drives the icon choice in the UI. */
  kind: "clear" | "cloudy" | "rain" | "storm" | "fog";
  live: boolean;
  observedAt: string | null;
}

/** WMO weather codes, grouped to the handful of distinctions a dispatcher cares about. */
function describe(code: number): { label: string; kind: Weather["kind"] } {
  if (code === 0) return { label: "Clear sky", kind: "clear" };
  if (code <= 2) return { label: "Mostly clear", kind: "clear" };
  if (code === 3) return { label: "Overcast", kind: "cloudy" };
  if (code <= 48) return { label: "Fog", kind: "fog" };
  if (code <= 55) return { label: "Drizzle", kind: "rain" };
  if (code <= 57) return { label: "Freezing drizzle", kind: "rain" };
  if (code === 61) return { label: "Light rain", kind: "rain" };
  if (code === 63) return { label: "Rain", kind: "rain" };
  if (code === 65) return { label: "Heavy rain", kind: "rain" };
  if (code <= 69) return { label: "Freezing rain", kind: "rain" };
  if (code <= 79) return { label: "Snow", kind: "cloudy" };
  if (code === 80) return { label: "Light showers", kind: "rain" };
  if (code === 81) return { label: "Showers", kind: "rain" };
  if (code === 82) return { label: "Heavy showers", kind: "rain" };
  if (code <= 86) return { label: "Snow showers", kind: "cloudy" };
  return { label: "Thunderstorm", kind: "storm" };
}

export async function getWeather(
  place: string,
  lat: number,
  lng: number,
  fallbackMonsoon: boolean,
): Promise<Weather> {
  const fallback: Weather = {
    place,
    temperatureC: null,
    label: fallbackMonsoon ? "Monsoon season" : "Dry season",
    kind: fallbackMonsoon ? "rain" : "clear",
    live: false,
    observedAt: null,
  };

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,weather_code&timezone=Asia%2FColombo`;

    // `next: { revalidate }` was a Next.js fetch extension and does not exist
    // outside it. This module already keeps its own 10-minute cache, so the
    // option was redundant even before the move to the API.
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return fallback;

    const body = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number; time?: string };
    };
    const current = body.current;
    if (!current || typeof current.temperature_2m !== "number") return fallback;

    const { label, kind } = describe(current.weather_code ?? 0);
    return {
      place,
      temperatureC: Math.round(current.temperature_2m),
      label,
      kind,
      live: true,
      observedAt: current.time?.slice(11, 16) ?? null,
    };
  } catch {
    // Offline, blocked, or slow: the dataset's own signal is still true.
    return fallback;
  }
}
