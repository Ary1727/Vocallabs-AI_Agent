import { createClient, generateServiceUrl } from '@nhost/nhost-js';

const subdomain = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'localhost';
const region = process.env.NEXT_PUBLIC_NHOST_REGION || 'local';

// createClient()/getUserSession()/generateServiceUrl() confirmed directly
// against @nhost/nhost-js v4's shipped .d.ts files (dist/src/nhost.d.ts,
// dist/src/session/session.d.ts) -- not guessed from docs/search results.
// Still genuinely UNVERIFIED end-to-end: this sandbox has no network path
// to nhost's cloud platform, so signing in against a real project and
// confirming the session actually round-trips has to happen on your
// machine. TypeScript confirming these methods EXIST is not the same as
// confirming the auth flow WORKS.
export const nhost = createClient({ subdomain, region });

export const graphqlHttpUrl = generateServiceUrl('graphql', subdomain, region);
// v4's generateServiceUrl doesn't expose a websocket variant -- Hasura's
// subscription endpoint is the same host as the HTTP GraphQL endpoint
// with the protocol swapped (http -> ws, https -> wss), which is standard
// Hasura behavior, not nhost-specific. Deriving it this way rather than
// hardcoding a separate URL construction.
export const graphqlWsUrl = graphqlHttpUrl.replace(/^http/, 'ws');
