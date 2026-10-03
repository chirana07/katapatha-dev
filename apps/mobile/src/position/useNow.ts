import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * A `Date` that refreshes while the app is active, so "Last sent 3 min ago" does
 * not sit on the screen saying 3 minutes for an hour. Pass it to `statusLine`.
 */
export function useNow(intervalMs: number = 20_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      setNow(new Date());
      timer ??= setInterval(() => setNow(new Date()), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === "active") start();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") start();
      else stop();
    });
    return () => {
      stop();
      subscription.remove();
    };
  }, [intervalMs]);
  return now;
}
