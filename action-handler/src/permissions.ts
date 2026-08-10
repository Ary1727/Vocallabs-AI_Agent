import { getMembership, OrgRole } from './db';

export class ForbiddenError extends Error {
  constructor(message = 'Not authorized for this organization.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Verifies the caller is a member of orgId with one of the allowed roles.
 * This is a deliberate SECOND check, independent of whatever Hasura's own
 * Action-level `permissions:` list already enforced (see actions.yaml).
 * Reasoning: Hasura's Action permissions gate who Hasura will even forward
 * a request to the handler for, but the handler cannot assume it will
 * only ever be called through Hasura with that guarantee intact — a
 * misconfigured Action, a direct call to the handler's HTTP endpoint
 * bypassing Hasura entirely (this handler is deployed as its own service,
 * reachable on its own URL), or a future metadata change that loosens the
 * Action's permissions would all bypass a permission check that lived
 * ONLY in Hasura YAML. Checking again here means the handler is correct
 * even if Hasura's config is wrong — the two layers aren't redundant,
 * they're independent.
 */
export async function requireOrgRole(userId: string, orgId: string, allowedRoles: OrgRole[]): Promise<OrgRole> {
  const membership = await getMembership(userId, orgId);
  if (!membership || !allowedRoles.includes(membership.role)) {
    // Same error, same message, regardless of whether the user isn't a
    // member at all vs. is a member with an insufficient role — do not
    // leak which case it was to someone probing an org they don't belong
    // to. This mirrors the "don't distinguish wrong-password from
    // no-such-user" pattern from auth design generally.
    throw new ForbiddenError();
  }
  return membership.role;
}
