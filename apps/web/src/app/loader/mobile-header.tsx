"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDownIcon, SwapIcon, WifiIcon } from "./icons";

/**
 * The phone's dark header (L-07, L-08): the connection state, what this
 * screen is about, one line of context, a bay picker and a progress bar.
 *
 * "Online" is the browser's own `navigator.onLine`, not a claim about the
 * server — a dock tablet on a flaky Wi-Fi should see it drop the moment the
 * browser does.
 */
export function MobileHeader({
  title,
  line,
  progressLabel,
  value,
  max,
  bays,
}: {
  title: string;
  line: string;
  progressLabel: string;
  value: number;
  max: number;
  /** The bay picker: the label on the button and the choices behind it. */
  bays: { label: string; options: { label: string; href: string; current: boolean }[] };
}) {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;

  return (
    <section className="-mx-4 -mt-4 rounded-b-[14px] bg-night px-4.5 pb-4 pt-3 text-white sm:-mx-6 sm:-mt-6 sm:px-6 lg:hidden">
      <div className="flex items-center justify-end gap-3">
        <span
          className={`inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-[10.5px] font-medium ${online ? "bg-[#16332b] text-[#22c55e]" : "bg-[#3b1d1d] text-[#f87171]"}`}
        >
          <span aria-hidden className={`size-1.5 rounded-full ${online ? "bg-[#22c55e]" : "bg-[#f87171]"}`} />
          {online ? "Online" : "Offline"}
        </span>
        <WifiIcon className={`size-4 ${online ? "text-[#22c55e]" : "text-[#f87171]"}`} />
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[21px] font-bold">{title}</h1>
          <p className="truncate text-[13px] text-[#94a3b8]">{line}</p>
        </div>
        <details className="relative shrink-0">
          <summary className="flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-[6px] border border-[#475569] px-2 text-[11px] font-medium [&::-webkit-details-marker]:hidden">
            <SwapIcon className="size-3.5" />
            {bays.label}
            <ChevronDownIcon className="size-3" />
          </summary>
          <ul className="absolute right-0 z-20 mt-1 max-h-72 min-w-36 overflow-y-auto rounded-[8px] border border-line bg-surface py-1 text-sm text-ink shadow-lg">
            {bays.options.map((option) => (
              <li key={option.href}>
                <Link
                  href={option.href}
                  aria-current={option.current ? "page" : undefined}
                  className={`block min-h-10 px-3 py-2 ${option.current ? "font-semibold text-ink" : "text-[#374151] hover:bg-raised"}`}
                >
                  {option.label}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      </div>
      <div className="mt-3 flex items-center justify-between text-[12.5px]">
        <span>{progressLabel}</span>
        <span className="tabular">{percent}%</span>
      </div>
      <div className="mt-1.5 h-[7px] overflow-hidden rounded-full bg-[#2a3650]" role="meter" aria-label={progressLabel} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className="h-full rounded-full bg-action" style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}
