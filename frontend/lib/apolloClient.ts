'use client';

import { ApolloClient, InMemoryCache, HttpLink, split } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient as createWsClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';
import { nhost, graphqlHttpUrl, graphqlWsUrl } from './nhost';

function buildClient() {
  const httpLink = new HttpLink({ uri: graphqlHttpUrl });

  // Dynamic per-request headers in Apollo Client go through setContext,
  // not HttpLink's own `headers` option (that one is for a static object,
  // not a function) -- passing a function directly there is a type error,
  // caught by tsc rather than discovered at runtime.
  const authLink = setContext(() => {
    const session = nhost.getUserSession();
    return {
      headers: session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {},
    };
  });

  // Subscriptions require a separate WS connection -- this is what powers
  // the live per-step status view and the "paused, awaiting approval"
  // state updating without a page refresh.
  const wsLink =
    typeof window !== 'undefined'
      ? new GraphQLWsLink(
          createWsClient({
            url: graphqlWsUrl,
            connectionParams: () => {
              const session = nhost.getUserSession();
              return session?.accessToken ? { headers: { Authorization: `Bearer ${session.accessToken}` } } : {};
            },
          })
        )
      : null;

  const authenticatedHttpLink = authLink.concat(httpLink);

  const splitLink =
    typeof window !== 'undefined' && wsLink
      ? split(
          ({ query }) => {
            const definition = getMainDefinition(query);
            return definition.kind === 'OperationDefinition' && definition.operation === 'subscription';
          },
          wsLink,
          authenticatedHttpLink
        )
      : authenticatedHttpLink;

  return new ApolloClient({
    link: splitLink,
    cache: new InMemoryCache(),
  });
}

export const apolloClient = buildClient();
