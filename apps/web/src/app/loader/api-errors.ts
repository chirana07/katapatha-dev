export type LoaderResource = "trips" | "trip" | "vocabularies";

export function readError(
  status: number,
  resource: LoaderResource,
): { title: string; detail: string; expired: boolean } {
  if (status === 401) {
    return {
      title: "Session expired",
      detail: "Sign in again at the dock terminal before opening the loader board.",
      expired: true,
    };
  }
  if (status === 403) {
    return {
      title: "Access denied",
      detail: "This account cannot view loader data for this depot.",
      expired: false,
    };
  }
  if (status === 404 && resource === "trip") {
    return {
      title: "Trip not found",
      detail: "This trip may belong to another depot or has been cancelled.",
      expired: false,
    };
  }
  return {
    title: titleFor(resource),
    detail: "Katapatha is temporarily unreachable from the dock terminal. Check the depot network before retrying.",
    expired: false,
  };
}

function titleFor(resource: LoaderResource): string {
  switch (resource) {
    case "trips":
      return "Dock board unavailable";
    case "trip":
      return "Load list unavailable";
    case "vocabularies":
      return "Reason list unavailable";
  }
}

export type LoadMutation = "record load check" | "mark the trip ready";

export function mutationError(status: number, action: LoadMutation): string {
  if (status === 401) return "The dock session expired. Sign in again before saving this change.";
  if (status === 403) return `This account cannot ${action} on this trip.`;
  if (status === 404) return "This trip or line is no longer available on the board.";
  if (status === 422) return "The server rejected these values. Check the quantity and reason, then try again.";
  if (status >= 500) return "Katapatha is temporarily unavailable. The last confirmed state is shown.";
  return `Katapatha could not ${action}. Check the dock network and try again.`;
}
