/**
 * Driver-readable copy for an HTTP status.
 *
 * Copied verbatim from apps/web/src/app/driver/api-errors.ts. One wording table for
 * both clients: a driver who used the web console yesterday should read the
 * same sentence on the handset today. Promotion into @katapatha/core is a later
 * move-only PR.
 */
export type DriverResource = "run" | "vehicle" | "stop" | "vocabularies";

export function readError(
  status: number,
  resource: DriverResource,
): { title: string; detail: string; expired: boolean } {
  if (status === 401) {
    return {
      title: "Sign in to continue",
      detail: "Your driver session is not active. Sign in again on the depot phone.",
      expired: true,
    };
  }
  if (status === 403) {
    return {
      title: "Access denied",
      detail: "This account cannot see driver data for this vehicle.",
      expired: false,
    };
  }
  if (status === 404 && resource === "stop") {
    return {
      title: "Stop not on this run",
      detail: "The stop may belong to a different vehicle or has been removed from the plan.",
      expired: false,
    };
  }
  return {
    title: titleFor(resource),
    detail: "Katapatha is temporarily unreachable from this phone. Check the signal and try again.",
    expired: false,
  };
}

function titleFor(resource: DriverResource): string {
  switch (resource) {
    case "run":
      return "Run unavailable";
    case "vehicle":
      return "Vehicle status unavailable";
    case "stop":
      return "Stop unavailable";
    case "vocabularies":
      return "Reason list unavailable";
  }
}

export type DriverMutation =
  | "claim this vehicle"
  | "release the vehicle"
  | "record arrival"
  | "start unloading"
  | "complete the delivery"
  | "report the problem";

export function mutationError(status: number, action: DriverMutation): string {
  if (status === 401) return "Your driver session expired. Sign in again before saving this action.";
  if (status === 403) return `This account cannot ${action}.`;
  if (status === 404) return "This stop or vehicle is no longer available on today's run.";
  if (status === 409) return "The server has a newer record for this stop. Reload the run before trying again.";
  if (status === 422) return "The server rejected these details. Review the quantities, reason, or recipient and try again.";
  if (status >= 500) return "Katapatha is temporarily unavailable. The last confirmed state is shown.";
  return `Katapatha could not ${action}. Check the signal and try again.`;
}
