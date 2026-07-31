// Runs before any test module is imported. Sets dummy-but-schema-valid Firebase env vars so
// `src/config/env.ts` (Zod validation) and `src/config/firebase.ts` (admin.initializeApp) don't
// throw on import. `dotenv/config` (loaded later, transitively) never overwrites values already
// set on process.env, so these take precedence even if a real `.env` file exists locally.
// Tests never talk to real Firestore: services/controllers are exercised against a fake Firestore
// double or with the service module mocked outright — see src/test-utils/fakeFirestore.ts.
process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'test-project';
process.env.FIREBASE_CLIENT_EMAIL =
  process.env.FIREBASE_CLIENT_EMAIL || 'test@test-project.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY =
  process.env.FIREBASE_PRIVATE_KEY ||
  '-----BEGIN PRIVATE KEY-----\nZmFrZS1wcml2YXRlLWtleS1mb3ItdGVzdHM=\n-----END PRIVATE KEY-----\n';
