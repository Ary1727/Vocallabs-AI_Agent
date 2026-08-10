'use client';

import { useQuery } from '@apollo/client';
import Link from 'next/link';
import { gql } from '@apollo/client';
import { useCurrentUser } from '@/lib/useAuth';

const GET_MY_ORGS = gql`
  query GetMyOrgs($userId: uuid!) {
    org_members(where: { user_id: { _eq: $userId } }) {
      org_id
      role
      organization {
        name
      }
    }
  }
`;

export default function OrgsPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const { data, loading } = useQuery(GET_MY_ORGS, { variables: { userId: user?.id }, skip: !user });

  if (userLoading || loading) return <div className="container">Loading…</div>;
  if (!user) return <div className="container">Please <Link href="/login">sign in</Link>.</div>;

  return (
    <div className="container">
      <h1>Your organizations</h1>
      {data?.org_members.map((m: { org_id: string; role: string; organization: { name: string } }) => (
        <div key={m.org_id} className="card">
          <Link href={`/orgs/${m.org_id}`}>{m.organization.name}</Link>
          <span className="pill pill-pending" style={{ marginLeft: 8 }}>{m.role}</span>
        </div>
      ))}
    </div>
  );
}
