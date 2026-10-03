/**
 * Rules for the driver's "Share my position" control.
 *
 * What it is: while the driver has switched it on AND the page is open, the
 * phone's own fix is sent to dispatch about once a minute, and dispatch shows
 * it as "last reported" with its age. What it is not: tracking. There is no
 * background reporting on the web, and nothing here may suggest otherwise.
 */
export const MIN_PING_INTERVAL_MS = 60_000;

export function shouldSendPing(lastSentAtMs: number | null, nowMs: number): boolean {
  return lastSentAtMs === null || nowMs - lastSentAtMs >= MIN_PING_INTERVAL_MS;
}

export interface PingFix {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}

export interface PingPayload {
  clientPingId: string;
  lat: number;
  lng: number;
  accuracyM?: number;
  recordedAt: string;
}

/**
 * A fix as the API wants it, or null when the browser handed us something
 * unusable. Coordinates are rounded to 5 decimals (about a metre), which is
 * more precision than a phone fix honestly has.
 */
export function buildPingPayload(fix: PingFix, recordedAtMs: number, clientPingId: string): PingPayload | null {
  const { latitude, longitude } = fix;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (!Number.isFinite(recordedAtMs)) return null;
  const payload: PingPayload = {
    clientPingId,
    lat: Math.round(latitude * 1e5) / 1e5,
    lng: Math.round(longitude * 1e5) / 1e5,
    recordedAt: new Date(recordedAtMs).toISOString(),
  };
  if (typeof fix.accuracy === "number" && Number.isFinite(fix.accuracy) && fix.accuracy >= 0) {
    payload.accuracyM = Math.round(fix.accuracy);
  }
  return payload;
}

/** `GeolocationPositionError.code` to words a driver can act on. */
export function geolocationErrorCopy(code: number): string {
  if (code === 1) {
    return "This page is not allowed to use your location. Allow location for Katapatha in the browser settings, then turn this on again.";
  }
  if (code === 2) return "The phone could not work out its position just now. It will keep trying while this is on.";
  if (code === 3) return "The phone took too long to find its position. It will keep trying while this is on.";
  return "The phone could not report its position.";
}

/** The API's refusal of a ping, in words. `code` comes from the error body. */
export function pingRefusalCopy(status: number, code?: string): string {
  if (code === "PING_IN_FUTURE") {
    return "The phone's clock looks ahead of the server's. Check the date and time on the phone.";
  }
  if (status === 401) return "Your session has ended. Sign in again to share your position.";
  if (status === 403) return "Claim a vehicle first. Dispatch can only place a position against a vehicle.";
  if (status >= 500 || status === 0) return "Katapatha did not answer, so that position was not confirmed as sent.";
  return "Katapatha refused that position.";
}
