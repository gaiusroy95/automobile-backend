# syntax=docker/dockerfile:1

################################################################################
# 1) deps — install ALL dependencies (incl. devDependencies), needed to compile TS
################################################################################
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm install` rather than `npm ci`: the lockfile has drifted from package.json (deps were
# added across several commits without anyone running `npm install` locally to refresh it), and
# `npm ci` hard-fails on any mismatch. `npm install` reconciles the two instead of demanding
# exact sync. See the "Installation" section of README.md for how to get back to `npm ci` here.
RUN npm install

################################################################################
# 2) build — compile TypeScript -> dist/
################################################################################
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm run build

################################################################################
# 3) prod-deps — install ONLY production dependencies, in their own clean layer
################################################################################
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
# See the note in the `deps` stage above — same reason for `npm install` over `npm ci`.
RUN npm install --omit=dev

################################################################################
# 4) runner — the actual image that ships: base + prod deps + compiled JS only
#    (no TypeScript, no devDependencies, no source, no test files)
################################################################################
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# The official Node image already ships a non-root `node` user (uid 1000) — use it
# instead of root.
USER node

EXPOSE 3000

# Requires Firebase Admin credentials at runtime — either FIREBASE_PROJECT_ID/
# FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY, or FIREBASE_SERVICE_ACCOUNT_PATH pointing at a
# mounted service-account JSON file (see .env.example). Pass them with `--env-file`/`-e`/your
# orchestrator's secret store — never bake real credentials into the image.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "dist/server.js"]
