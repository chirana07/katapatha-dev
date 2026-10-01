import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SqlDriver } from "../db/driver";
import { hasToken } from "../api/client";
import {
  fetchMe,
  signIn as apiSignIn,
  signOut as apiSignOut,
  type SessionUser,
  type SignInResult,
} from "../api/session";

/**
 * Who is signed in.
 *
 * The important behaviour is what happens at launch with no signal: a stored
 * token is treated as a valid session until the server actively says otherwise
 * with a 401. Requiring a successful /auth/me to stay signed in would sign a
 * driver out in a dead spot -- exactly where they can do nothing about it, and
 * exactly where this app is supposed to be useful. The 30-day non-rotating
 * session in apps/api exists for the same reason.
 */

export type SessionState = {
  status: "loading" | "signed-in" | "signed-out";
  user: SessionUser | null;
  /** Set when a request has reported 401. The UI invites a fresh sign-in. */
  expired: boolean;
};

type SessionContextValue = SessionState & {
  signIn: (credentials: { email: string; password: string }) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  /** Called by the drain when a request comes back 401. */
  markExpired: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  sql,
  children,
}: {
  sql: SqlDriver;
  children: ReactNode;
}) {
  const [state, setState] = useState<SessionState>({
    status: "loading",
    user: null,
    expired: false,
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!(await hasToken())) {
        if (!cancelled) setState({ status: "signed-out", user: null, expired: false });
        return;
      }

      const me = await fetchMe(sql);
      if (cancelled) return;

      if (me.kind === "expired") {
        setState({ status: "signed-out", user: null, expired: true });
        return;
      }

      // "unreachable" keeps the driver signed in, with no user profile until the
      // server can be asked again. The run comes from the cache meanwhile.
      setState({
        status: "signed-in",
        user: me.kind === "ok" ? me.user : null,
        expired: false,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [sql]);

  const signIn = useCallback(
    async (credentials: { email: string; password: string }) => {
      const result = await apiSignIn(sql, credentials);
      if (result.kind === "ok") {
        setState({ status: "signed-in", user: result.user, expired: false });
      }
      return result;
    },
    [sql],
  );

  const signOut = useCallback(async () => {
    await apiSignOut(sql);
    setState({ status: "signed-out", user: null, expired: false });
  }, [sql]);

  const markExpired = useCallback(() => {
    setState((previous) => ({ ...previous, status: "signed-out", expired: true }));
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ ...state, signIn, signOut, markExpired }),
    [state, signIn, signOut, markExpired],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside SessionProvider (see src/app/_layout.tsx).");
  }
  return context;
}
