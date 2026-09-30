import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "@katapatha/contracts/types";

export type Katapatha = ReturnType<typeof createClient<paths>>;

export interface ClientOptions {
  /** e.g. "/v1" in the browser, "http://localhost:3001/v1" on a server or device. */
  baseUrl: string;
  /**
   * Returns the bearer token, for the mobile app. The web app leaves this
   * undefined and relies on the httpOnly cookie instead.
   */
  getToken?: () => string | undefined | Promise<string | undefined>;
  /** Forwarded verbatim. The web server uses this to pass the caller's cookie. */
  headers?: Record<string, string>;
}

/**
 * The one way any client talks to the API.
 *
 * Types come from the generated contract, so a request or response that does
 * not match the spec is a compile error rather than a runtime surprise.
 */
export function createKatapathaClient(options: ClientOptions): Katapatha {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    headers: options.headers,
    credentials: "include",
  });

  if (options.getToken) {
    const auth: Middleware = {
      async onRequest({ request }) {
        const token = await options.getToken?.();
        if (token) request.headers.set("Authorization", `Bearer ${token}`);
        return request;
      },
    };
    client.use(auth);
  }

  return client;
}
