'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { nhost } from '@/lib/nhost';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const result = await nhost.auth.signInEmailPassword({ email, password });
      if (!result.body?.session) {
        setError('Sign in failed — check your credentials.');
        return;
      }
      router.push('/orgs');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    }
  }

  return (
    <div className="container" style={{ maxWidth: 400, marginTop: 80 }}>
      <h1>VocalLabs</h1>
      <p>AI Agent Workflow Builder</p>
      <form onSubmit={handleSubmit} className="card">
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required style={{ width: '100%', marginBottom: 10 }} />
        <label>Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required style={{ width: '100%', marginBottom: 10 }} />
        {error && <p style={{ color: '#ff9d9d' }}>{error}</p>}
        <button type="submit" style={{ width: '100%' }}>Sign in</button>
      </form>
    </div>
  );
}
