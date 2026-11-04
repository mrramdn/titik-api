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
   * The server has said who is signed in here: the session check answered, or a sign-in went through, in this tab or in
   * another one. False while the check failed (no signal, a server error, too many requests, a timeout): `user` is then
   * a copy from an earlier visit or nobody, and the browser may still hold a real account's session cookie.
   */
  checked: boolean;
  offline: boolean;
  signInDemo(role: 'mpa' | 'kades' | 'bpbd'): Promise<User>; signIn(email: string, password: string): Promise<User>; signOut(): Promise<void>;
}
const SessionContext = createContext<Session | null>(null);
const cacheKey = 'titikapi.user';
/** A session check that takes longer gives up, like one without a signal: a server that hangs says nothing either. */
const CHECK_TIMEOUT_MS = 10_000;
/** A session check without an answer is asked again after this long, and as soon as the browser is back online. */
const RETRY_MS = 30_000;

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
  // What this browser kept for one account is forgotten before another account, or a visitor, reads anything. An
  // account another tab stored is not stored again: that could put it back over a newer one a third tab stored.
  const [settle] = useState(() => accountSettler<User>(user, (next, followed) => {
    setUser(next);
    if (!followed) remember(next);
    setOutboxAccount(next?.id ?? null);
  }));
  // Counts the sign-ins and sign-outs that went through, here or in another tab: a session check answered after one of
  // them tells of the session cookie before it, and is left out.
  const changes = useRef(0);
  // Session checks in a row that got no answer; while there is one, the check is asked again (see below).
  const [unanswered, setUnanswered] = useState(0);
  const check = useCallback((first: boolean) => {
    const at = changes.current;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), CHECK_TIMEOUT_MS);
    return api<{ data: User | null }>('/auth/me', { signal: timeout.signal })
      .then(async response => {
        if (changes.current !== at) return;
        setUnanswered(0);
        await settle(response.data);
        setChecked(true);
      })
      .catch(error => {
        if (changes.current !== at) return;
        // Only an answer says who is signed in; without one (no signal, a timeout, a server error during a deploy, too
        // many requests) the session cookie may well be valid. The last known account stays, for the screen and for
        // the outbox, so a volunteer can still file reports and they go out under it. If the session did end, the
        // outbox's first report meets a 401 and the check is asked again.
        if (first) {
          if (error instanceof ApiError && error.status === 0) setOffline(true);
          setOutboxAccount(cached()?.id ?? null);
        }
        setUnanswered(count => count + 1);
      })
      .finally(() => clearTimeout(timer));
  }, [settle]);
  useEffect(() => { void check(true).finally(() => setReady(true)); }, [check]);
  useEffect(() => {
    if (!unanswered) return;
    const again = () => { void check(false); };
    const timer = setTimeout(again, RETRY_MS);
    window.addEventListener('online', again);
    return () => { clearTimeout(timer); window.removeEventListener('online', again); };
  }, [unanswered, check]);
  // A waiting report met a 401: the session ended while this browser still shows the account. Asked again, the server
  // says who is signed in now (nobody, most likely), and the screen follows, so the volunteer can sign in again. Once
  // a minute at most.
  const recheckedAt = useRef(0);
  useEffect(() => onSessionEnded(() => {
    if (Date.now() - recheckedAt.current < 60_000) return;
    recheckedAt.current = Date.now();
    void check(false);
  }), [check]);
  // Another tab signed in or out, or its session check answered. The session cookie is the same for every tab, so this
  // tab takes that account in full: the screen, the outbox banner, the task marks and the field check page follow it,
  // and its waiting reports go out under it. What the last account kept is already gone (see accountSettler). A
  // session check of this tab still on its way tells of the cookie before, so it is left out, and one asked again
  // later is not needed: another tab writes an account only after the server answered, or after a sign-out.
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.key !== cacheKey) return;
      let next: User | null = null;
      try { next = JSON.parse(event.newValue ?? 'null'); } catch { /* not a user */ }
      changes.current++;
      setUnanswered(0);
      void settle(next, true).then(() => setChecked(true));
    };
    window.addEventListener('storage', follow);
    return () => window.removeEventListener('storage', follow);
  }, [settle]);
  const signInDemo = useCallback(async (role: 'mpa' | 'kades' | 'bpbd') => {
    const release = holdOutbox();
    try {
      const response = await api<{ data: { user: User } }>('/auth/demo', { method: 'POST', json: { role, client: 'web' } });
      changes.current++;
      setUnanswered(0);
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
      setUnanswered(0);
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
      // A check asked again later must not sign back in an account the visitor left (a logout without a signal leaves
      // the session on the server).
      setUnanswered(0);
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
