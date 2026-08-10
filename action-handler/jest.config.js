module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.test.ts'],
  // Without this, `npm test` never loads .env — only server.ts does, via
  // `import 'dotenv/config'` at its own top. Jest runs test files
  // directly, bypassing server.ts entirely, so DATABASE_URL (and
  // everything else in .env) was silently undefined during `npm test`,
  // and db.ts's connection fallback has no password — which is exactly
  // what produced "SASL: SCRAM-SERVER-FIRST-MESSAGE: client password
  // must be a string" the first time this ran without an inline env var.
  setupFiles: ['dotenv/config'],
  // The integration test files (runWorkflow.test.ts, approveStep.test.ts)
  // both call resetAndSeed(), which TRUNCATEs and re-inserts the SAME
  // hardcoded organization IDs from testSeed.ts, against the SAME
  // Postgres database. Jest runs test FILES in parallel by default; two
  // files racing to truncate/insert those same rows at once produced
  // "duplicate key value violates unique constraint organizations_pkey"
  // -- not a flaky environment issue, a real gap in this config. Forcing
  // maxWorkers to 1 makes `npm test` alone behave the same way
  // `npx jest --runInBand` always did in development, without requiring
  // the flag to be remembered on every invocation.
  maxWorkers: 1,
};
