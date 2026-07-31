import { env } from './env';

// `cors`'s `origin` option accepts a single string, an array, or `true`/`false` — an array lets
// the Angular frontend's deployed URL and a local dev URL (e.g. http://localhost:4200) coexist.
const corsOrigin =
  env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(',').map((origin) => origin.trim());

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isDevelopment: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  corsOrigin,
  adminApiKey: env.ADMIN_API_KEY,
  firebase: {
    serviceAccountPath: env.FIREBASE_SERVICE_ACCOUNT_PATH,
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    emulatorHost: env.FIRESTORE_EMULATOR_HOST,
  },
} as const;
