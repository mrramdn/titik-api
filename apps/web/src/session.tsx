import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { accountSettler } from './accountData';
import { api, ApiError, type User } from './api';
import { holdOutbox, onSessionEnded, setOutboxAccount } from './outbox';
import { MAP_PATH } from './routes';

interface Session {
  user: User | null;
  /** The session check (GET /auth/me) has finished, answered or not. */
  ready: boolean;
  /**
   * The server has said who is signed in here: the session check answered, or a sign-in went through. False while the
   * check failed (no signal, a server error, too many requests): `user` is then a copy from an earlier visit or nobody,
   * and the browser may still hold a real account's session cookie.
   */
  checked: boolean;
  offline: boolean;
  signInDemo(role: 'mpa' | 'kades' | 'bpbd'): Promise<User>; signIn(email: string, password: string): Promise<User>; signOut(): Promise<void>;
}
const SessionContext = createContext<Session | null>(null);
const cacheKey = 'titikapi.user';

function cached(): User | null {
  try { return JSON.parse(localStorage.getItem(cacheKey) ?? 'null'); } catch { return null; }
}
function remember(user: User | null) {
  try { if (user) localStorage.setItem(cacheKey, JSON.stringify(user)); else localStorage.removeItem(cacheKey); } catch { /* private mode */ }
}

/**
 * Waiting field reports go out only under the account that filed it (outbox.ts), so the outbox hears of the account
 * whenever the session does, and is held while a sign-in or sign-out is under way.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(cached);
  const [ready, setReady] = useState(false);
  const [checked, setChecked] = useState(false);
  const [offline, setOffline] = useState(false);
  // What this browser kept for one account is forgotten before another account, or a visitor, reads anything.
  const [settle] = useState(() => accountSettler<User>(user, next => { setUser(next); remember(next); setOutboxAccount(next?.id ?? null); }));
  // Counts the sign-ins and sign-outs that went through: a session check answered after one of them tells of the
  // session cookie before it, and is left out.
  const changes = useRef(0);
  const check = useCallback((first: boolean) => {
    const at = changes.current;
    return api<{ data: User | null }>('/auth/me')
      .then(async response => { if (changes.current !== at) return; await settle(response.data); setChecked(true); })
      .catch(error => {
        if (changes.current !== at) return;
        // Without a signal the last known account stays, so a volunteer in the field can still file reports; the
        // outbox sends them under it once the signal is back.
        if (error instanceof ApiError && error.status === 0) { if (first) { setOffline(true); setOutboxAccount(cached()?.id ?? null); } }
        else return settle(null);
      });
  }, [settle]);
  useEffect(() => { void check(true).finally(() => setReady(true)); }, [check]);
  // A waiting report met a 401: the session ended while this browser still shows the account. Asked again, the server
  // says who is signed in now (nobody, most likely), and the screen follows, so the volunteer can sign in again. Once
  // a minute at most.
  const recheckedAt = useRef(0);
  useEffect(() => onSessionEnded(() => {
    if (Date.now() - recheckedAt.current < 60_000) return;
    recheckedAt.current = Date.now();
    void check(false);
  }), [check]);
  // Another tab signed in or out. The session cookie is the same for every tab, so this tab's waiting reports go out
  // under that account from now on (the screen keeps what it shows until its next sign-in or reload).
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.key !== cacheKey) return;
      let next: User | null = null;
      try { next = JSON.parse(event.newValue ?? 'null'); } catch { /* not a user */ }
      setOutboxAccount(next?.id ?? null);
    };
    window.addEventListener('storage', follow);
    return () => window.removeEventListener('storage', follow);
  }, []);
  const signInDemo = useCallback(async (role: 'mpa' | 'kades' | 'bpbd') => {
    const release = holdOutbox();
    try {
      const response = await api<{ data: { user: User } }>('/auth/demo', { method: 'POST', json: { role, client: 'web' } });
      changes.current++;
      await settle(response.data.user);
      setChecked(true);
      return response.data.user;
    } finally { release(); }
  }, [settle]);
  const signIn = useCallback(async (email: string, password: string) => {
    const release = holdOutbox();
    try {
      const response = await api<{ data: { user: User } }>('/auth/login', { method: 'POST', json: { email, password, client: 'web' } });
      changes.current++;
      await settle(response.data.user);
      setChecked(true);
      return response.data.user;
    } finally { release(); }
  }, [settle]);
  const signOut = useCallback(async () => {
    const release = holdOutbox();
    try {
      // Answered (signed out, or there was no session to end): the server has said nobody is signed in here.
      const answered = await api('/auth/logout', { method: 'POST' }).then(() => true, error => error instanceof ApiError && error.status === 401);
      changes.current++;
      await settle(null);
      if (answered) setChecked(true);
    } finally { release(); }
  }, [settle]);
  return <SessionContext.Provider value={{ user, ready, checked, offline, signInDemo, signIn, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('SessionProvider missing');
  return session;
}

/** Where each role starts: visitors on the map, volunteers on their tasks, village heads on their village, agencies on the dashboard. */
export const homeFor = (user: User | null) => (!user ? MAP_PATH : user.role === 'bpbd' || user.role === 'admin' ? '/dasbor' : user.role === 'kades' ? '/desa-saya' : '/tugas');
