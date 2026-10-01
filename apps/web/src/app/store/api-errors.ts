export type StoreMutation = "place order" | "confirm receipt";

export function mutationError(status: number, action: StoreMutation): string {
  if (status === 401) return "Your session expired. Sign in again, then review the order before retrying.";
  if (status === 403) return `Your account is not allowed to ${action} for this outlet.`;
  if (status === 422) return "The server rejected these details. Review the quantities and try again.";
  if (status >= 500) return "Katapatha is temporarily unavailable. Check the order list before retrying.";
  return `Katapatha could not ${action}. Check the connection and try again.`;
}

export function readError(status: number, resource: "orders" | "order"): { title: string; detail: string } {
  if (status === 401) {
    return {
      title: "Session expired",
      detail: "Sign in again before viewing Store information.",
    };
  }
  if (status === 403) {
    return {
      title: "Access denied",
      detail: `This account cannot view ${resource === "orders" ? "these orders" : "this order"}.`,
    };
  }
  if (status === 404 && resource === "order") {
    return { title: "Order not found", detail: "The order may have been removed or belongs to another outlet." };
  }
  return {
    title: resource === "orders" ? "Orders could not be loaded" : "Order unavailable",
    detail: "Check the connection to the Katapatha API, then try again.",
  };
}
