'use client';

import { useEffect, useState } from 'react';
import { nhost } from './nhost';

export interface CurrentUser {
  id: string;
  email: string | null;
}

// v4's client has no onAuthStateChanged listener (confirmed absent from
// the shipped NhostClient type -- see nhost.ts comment). getUserSession()
// is synchronous and reads from local storage, so this hook checks it on
// mount and again whenever the window regains focus (covers the common
// case of signing in on this tab and navigating back). It does NOT
// reactively update mid-session the way a real auth-state listener would
// (e.g. a token silently expiring while the tab sits idle) -- documented
// as a known simplification. A production version would want to poll
// nhost.refreshSession() on an interval or wrap fetches with a 401 retry
// that re-checks the session.
export function useCurrentUser(): { user: CurrentUser | null; loading: boolean } {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  function readSession() {
    const session = nhost.getUserSession();
    setUser(session?.user ? { id: session.user.id, email: session.user.email ?? null } : null);
  }

  useEffect(() => {
    readSession();
    setLoading(false);

    window.addEventListener('focus', readSession);
    return () => window.removeEventListener('focus', readSession);
  }, []);

  return { user, loading };
}
