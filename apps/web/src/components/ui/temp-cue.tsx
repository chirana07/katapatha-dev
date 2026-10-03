/**
 * "Ambient" or "Chilled", as an icon and a word.
 *
 * The temperature decides which vehicle can carry a product, so it is never
 * left to colour: the snowflake and the word say it, and the tint only echoes
 * it. Plain markup, usable from server and client components.
 */
export function TempCue({ temp, className = "" }: { temp: "ambient" | "chilled"; className?: string }) {
  const chilled = temp === "chilled";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${chilled ? "text-info-ink" : "text-muted"} ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden>
        {chilled ? (
          <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
          </>
        )}
      </svg>
      {chilled ? "Chilled" : "Ambient"}
    </span>
  );
}
