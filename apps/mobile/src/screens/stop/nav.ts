import { router } from "expo-router";

/**
 * Back, even when there is nothing to go back to (a deep link or a restored
 * session lands on the stop with an empty history): then it goes to the Trip.
 */
export function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace("/(driver)");
}

/** The Trip, dropping the stop screens above it so Back from the Trip does not return to them. */
export function goToTrip(): void {
  router.dismissTo("/(driver)");
}
