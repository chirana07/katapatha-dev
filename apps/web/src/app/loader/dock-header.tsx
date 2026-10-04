"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarIcon, ClockIcon } from "./icons";

/**
 * The dock's page header (L-02, L-05, L-06): title and subtitle on the left;
 * the day and the clock as two cards on the right.
 *
 * The date card is the day picker: it opens the native date picker and the
 * page follows `?date=`, keeping the rest of the query. The clock says whether
 * the dock is on time — from the server's own "minutes behind the loading
 * plan", so it only has something to say on today; on any other day it says
 * which day is on screen instead of vouching for a clock nobody is racing.
 */
export function DockHeader({
  title,
  subtitle,
  date,
  path,
  keep = {},
  behindMinutes,
  isToday,
  action,
}: {
  title: string;
  subtitle: string;
  date: string;
  path: string;
  keep?: Record<string, string | undefined>;
  /** The most any open vehicle is behind its loading plan; null when unknown. */
  behindMinutes: number | null;
  isToday: boolean;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-[29px] font-bold leading-tight tracking-tight text-[#111827]">{title}</h1>
        <p className="mt-1 text-base text-[#374151]">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <DateCard date={date} path={path} keep={keep} />
        {action ?? <ClockCard behindMinutes={behindMinutes} isToday={isToday} />}
      </div>
    </header>
  );
}

function DateCard({ date, path, keep }: { date: string; path: string; keep: Record<string, string | undefined> }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const label = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`))
    .replace(/^(\w+)/, "$1,");

  function go(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const params = new URLSearchParams();
    for (const [key, v] of Object.entries(keep)) if (v) params.set(key, v);
    params.set("date", value);
    router.push(`${path}?${params.toString()}`);
  }

  return (
    <label className="relative inline-flex h-13 cursor-pointer items-center gap-2.5 rounded-control border border-[#e5e7eb] bg-surface px-3.5 text-sm text-[#111827] focus-within:ring-2 focus-within:ring-link">
      <CalendarIcon className="size-4.5 text-[#111827]" />
      <span className="tabular whitespace-nowrap">{label.replace(/,,/, ",")}</span>
      <span className="sr-only">Change the day</span>
      <input
        ref={input}
        type="date"
        defaultValue={date}
        onChange={(event) => go(event.target.value)}
        onClick={() => input.current?.showPicker?.()}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  );
}

function ClockCard({ behindMinutes, isToday }: { behindMinutes: number | null; isToday: boolean }) {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const format = () =>
      new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date());
    const tick = () => setTime(format());
    tick();
    const handle = setInterval(tick, 15_000);
    return () => clearInterval(handle);
  }, []);

  const status = !isToday
    ? { text: "Not today", cls: "text-muted", dot: "bg-muted" }
    : behindMinutes != null && behindMinutes > 0
      ? { text: `${behindMinutes} min behind`, cls: "text-warn-ink", dot: "bg-warn" }
      : { text: "On time", cls: "text-good", dot: "bg-good" };

  return (
    <div className="inline-flex h-13 items-center gap-3 rounded-control border border-[#e5e7eb] bg-surface px-3">
      <ClockIcon className="size-5 text-[#111827]" />
      <span className="sr-only">Time in Colombo</span>
      <span className="tabular whitespace-nowrap text-base font-semibold text-[#111827]">{time ?? "--:--"}</span>
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-medium ${status.cls}`}>
        <span aria-hidden className={`size-2 rounded-full ${status.dot}`} />
        {status.text}
      </span>
    </div>
  );
}
