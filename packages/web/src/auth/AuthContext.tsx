import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiClient } from '../api/client';
import type { User } from '../api/types';

const STORAGE_KEY = 'prms.session';

interface Session {
  token: string;
  user: User;
}

interface AuthContextValue {
  user: User | null;
  api: ApiClient;
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Session storage: survives a reload, but not closing the tab — a sensible
// default for a shared ship terminal.
function readStoredSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function storeSession(session: Session | null): void {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be unavailable (e.g. private mode); the session then lives in memory only.
  }
}

export function AuthProvider({ children, client }: { children: ReactNode; client?: ApiClient }) {
  const [session, setSession] = useState<Session | null>(readStoredSession);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const logout = useCallback(() => {
    storeSession(null);
    sessionRef.current = null;
    setSession(null);
  }, []);

  const api = useMemo(
    () =>
      client ??
      new ApiClient({ getToken: () => sessionRef.current?.token ?? null, onUnauthorized: logout }),
    [client, logout],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      const result = await api.post<{ token: string; user: User }>('/api/auth/login', {
        username,
        password,
      });
      const next = { token: result.token, user: result.user };
      storeSession(next);
      sessionRef.current = next;
      setSession(next);
      return result.user;
    },
    [api],
  );

  const value = useMemo(
    () => ({ user: session?.user ?? null, api, login, logout }),
    [session, api, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
