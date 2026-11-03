import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { accountSettler } from './accountData';
import { api, ApiError, type User } from './api';

interface Session { user: User | null; ready: boolean; offline: boolean; signInDemo(role: 'mpa' | 'kades' | 'bpbd'): Promise<User>; signIn(email: string, password: string): Promise<User>; signOut(): Promise<void> }
const SessionContext = createContext<Session | null>(null);
const cacheKey = 'titikapi.user';

function cached(): User | null {
  try { return JSON.parse(localStorage.getItem(cacheKey) ?? 'null'); } catch { return null; }
}
function remember(user: User | null) {
  try { if (user) localStorage.setItem(cacheKey, JSON.stringify(user)); else localStorage.removeItem(cacheKey); } catch { /* private mode */ }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(cached);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  // What this browser kept for one account is forgotten before another account, or a visitor, reads anything.
  const [settle] = useState(() => accountSettler<User>(user, next => { setUser(next); remember(next); }));
  useEffect(() => {
    api<{ data: User | null }>('/auth/me')
      .then(response => settle(response.data))
      .catch(error => {
        // Without a signal the last known account stays, so a volunteer in the field can still file reports.
        if (error instanceof ApiError && error.status === 0) setOffline(true);
        else return settle(null);
      })
      .finally(() => setReady(true));
  }, [settle]);
  const signInDemo = useCallback(async (role: 'mpa' | 'kades' | 'bpbd') => {
    const response = await api<{ data: { user: User } }>('/auth/demo', { method: 'POST', json: { role, client: 'web' } });
    await settle(response.data.user);
    return response.data.user;
  }, [settle]);
  const signIn = useCallback(async (email: string, password: string) => {
    const response = await api<{ data: { user: User } }>('/auth/login', { method: 'POST', json: { email, password, client: 'web' } });
    await settle(response.data.user);
    return response.data.user;
  }, [settle]);
  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    await settle(null);
  }, [settle]);
  return <SessionContext.Provider value={{ user, ready, offline, signInDemo, signIn, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('SessionProvider missing');
  return session;
}

/** Where each role starts: volunteers on their tasks, village heads on their village, agencies on the dashboard. */
export const homeFor = (user: User | null) => (!user ? '/' : user.role === 'bpbd' || user.role === 'admin' ? '/dasbor' : user.role === 'kades' ? '/desa-saya' : '/tugas');
