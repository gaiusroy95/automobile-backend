import 'dotenv/config';
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    // Comma-separated list of allowed origins (e.g. the Angular frontend's URL(s)), or "*".
    CORS_ORIGIN: z.string().default('*'),

    // Firebase Admin credentials — two supported strategies, see the refinement below:
    //  1) FIREBASE_SERVICE_ACCOUNT_PATH: path to a mounted service-account JSON file
    //     (Render "Secret Files" mounts these under /etc/secrets/<name>).
    //  2) The three discrete fields below, straight from the service-account JSON
    //     (works with a plain Render environment variable, multi-line values included).
    FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
    FIREBASE_PROJECT_ID: z.string().optional(),
    FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
    FIREBASE_PRIVATE_KEY: z.string().optional(),

    FIRESTORE_EMULATOR_HOST: z.string().optional(),

    // Shared secret required to create a new automobile record (POST /cars). There's no user
    // account system in this app — this is a deliberately lightweight gate (a single password
    // for the one person who's allowed to add data), not a substitute for real auth.
    ADMIN_API_KEY: z.string().min(1),
  })
  .superRefine((data, ctx) => {
    const hasServiceAccountPath = Boolean(data.FIREBASE_SERVICE_ACCOUNT_PATH);
    const hasDiscreteCredentials = Boolean(
      data.FIREBASE_PROJECT_ID && data.FIREBASE_CLIENT_EMAIL && data.FIREBASE_PRIVATE_KEY,
    );

    if (!hasServiceAccountPath && !hasDiscreteCredentials) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Provide Firebase Admin credentials either via FIREBASE_SERVICE_ACCOUNT_PATH ' +
          '(a mounted service-account JSON file) or all three of FIREBASE_PROJECT_ID, ' +
          'FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.',
      });
    }
  });

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }

  return parsed.data;
}

export const env = loadEnv();
export type Env = typeof env;
