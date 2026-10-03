import type { Tone } from "@/components/ui/status-pill";
import { agoFrom } from "@/lib/format";
import { formatTemp } from "./shortage";

/**
 * How a chiller reading is worded.
 *
 * A reading is a named person's look at a gauge, so every line says who, where
 * and how long ago, and the age is measured from `recordedAt` (when the gauge
 * was read), never from when this screen received it. The band comes with the
 * reading — it was copied onto it when it was taken — so a later policy change
 * cannot make an old figure read differently.
 */
export type Reading = {
  tempC: number;
  targetMinC: number;
  targetMaxC: number;
  inRange: boolean;
  source?: "LOADER_AT_BAY" | "DRIVER_ON_ARRIVAL";
  recordedByName: string | null;
  recordedAt: string;
};

export function chillerVerdict(reading: Reading): { label: string; tone: Tone } {
  if (reading.inRange) return { label: "in range", tone: "good" };
  return reading.tempC > reading.targetMaxC ? { label: "too warm", tone: "bad" } : { label: "too cold", tone: "bad" };
}

/** "6 °C too warm" */
export function chillerHeadline(reading: Reading): string {
  return `${formatTemp(reading.tempC)} ${chillerVerdict(reading).label}`;
}

/** "read by Ranjith Silva at the bay · 35 min ago · target 2–5 °C" */
export function chillerByline(reading: Reading, now: Date = new Date()): string {
  const where = reading.source === "DRIVER_ON_ARRIVAL" ? "on arrival" : "at the bay";
  const who = reading.recordedByName ?? (reading.source === "DRIVER_ON_ARRIVAL" ? "the driver" : "a loader");
  return `read by ${who} ${where} · ${agoFrom(reading.recordedAt, now)} · target ${reading.targetMinC}–${reading.targetMaxC} °C`;
}
