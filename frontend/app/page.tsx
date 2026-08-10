'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from '@/lib/useAuth';

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useCurrentUser();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/orgs' : '/login');
  }, [user, loading, router]);

  return <div className="container">Loading…</div>;
}
