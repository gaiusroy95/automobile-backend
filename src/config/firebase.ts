import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import admin from 'firebase-admin';
import { config } from './index';

/**
 * Two supported credential strategies (enforced by the Zod refinement in env.ts, so exactly one
 * is guaranteed to be usable by the time this runs):
 *  1) A service-account JSON file on disk — e.g. a Render "Secret File" mounted at
 *     /etc/secrets/<name>, referenced via FIREBASE_SERVICE_ACCOUNT_PATH.
 *  2) The three discrete fields lifted from that same JSON, as plain environment variables.
 */
function loadCredential(): admin.credential.Credential {
  if (config.firebase.serviceAccountPath) {
    const raw = readFileSync(resolve(config.firebase.serviceAccountPath), 'utf-8');
    return admin.credential.cert(JSON.parse(raw));
  }

  return admin.credential.cert({
    projectId: config.firebase.projectId,
    clientEmail: config.firebase.clientEmail,
    privateKey: config.firebase.privateKey,
  });
}

function initializeFirebase(): admin.app.App {
  if (admin.apps.length > 0) {
    return admin.apps[0] as admin.app.App;
  }

  return admin.initializeApp({ credential: loadCredential() });
}

export const firebaseApp = initializeFirebase();
