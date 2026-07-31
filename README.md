# Backend

Production-ready Express + TypeScript backend, deployable to Render as a Docker web service.
Organized in layers rather than by feature: each of the folders below holds one concern across
the whole app, and a given resource (e.g. "automobile") has one file per layer.

## Structure

```
src/
  config/           Environment loading & validation, Firebase Admin initialization
  controllers/      HTTP request handlers — read req.validated, call a service, shape the response
  models/           Domain types + Zod validation schemas (Automobile, pagination, filters)
  services/         Business logic + Firestore data access
  routes/           Express routers — wire validate() + a controller to a path per resource
  middleware/       Cross-cutting Express middleware (validation, error handling, request id, 404s)
  scripts/          One-off CLI scripts (the CSV importer) — not part of the running app
  test-utils/       Test doubles/fixtures shared across test files (not shipped in the image)
  types/            Ambient type augmentation (req.id, req.validated)
  utils/            Cross-cutting helpers (ApiError, asyncHandler, sendSuccess, logger)
  app.ts            Express app assembly (middleware pipeline, route mounting)
  server.ts         Process entrypoint (listen, graceful shutdown)
```

Adding a resource:

1. Add its shape + validation schemas to `src/models/<name>.model.ts`.
2. Add `src/services/<name>.service.ts` (business logic / Firestore access).
3. Add `src/controllers/<name>.controller.ts` (thin — no logic beyond reading `req.validated`,
   calling the service, and calling `sendSuccess`).
4. Add `src/routes/<name>.routes.ts` and mount it in `src/routes/index.ts`.

## Installation

Requires Node.js >= 18 and npm.

```bash
cd backend
npm install
cp .env.example .env   # then fill in the Firebase values — see Environment Variables below
```

⚠️ `package-lock.json` is currently out of sync with `package.json` (dependencies were added
across several commits without anyone running `npm install` locally to refresh the lockfile
afterward). The Docker build works around this today by using `npm install` instead of `npm ci`
(see Docker below), but that's a workaround, not a fix — `npm install` silently tolerates drift
instead of catching it. To actually fix it: run `npm install` locally once, commit the
regenerated `package-lock.json`, then switch the Dockerfile back to `npm ci` for reproducible,
drift-checked installs.

## Environment Variables

All variables are loaded from `.env` (via `dotenv`) and validated at startup with Zod
(`src/config/env.ts`) — a missing or malformed value fails fast with a clear error instead of the
server booting into a broken state. See `.env.example` for a filled-in template.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `development` | `development` \| `test` \| `production` |
| `PORT` | No | `3000` | Port the HTTP server listens on. Render sets this itself for Docker services — don't hardcode it in Render's dashboard/`.render.yaml` |
| `CORS_ORIGIN` | No | `*` | Comma-separated list of allowed origins (e.g. your deployed Angular app + `http://localhost:4200`), or `*` for any |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | One of these two Firebase strategies is required | — | Path to a service-account JSON file (e.g. a Render "Secret File" at `/etc/secrets/<name>`). Takes precedence over the three fields below if set |
| `FIREBASE_PROJECT_ID` | ⤷ | — | Firebase service account's `project_id` |
| `FIREBASE_CLIENT_EMAIL` | ⤷ | — | Firebase service account's `client_email` |
| `FIREBASE_PRIVATE_KEY` | ⤷ | — | Firebase service account's `private_key` (keep the quotes and `\n` sequences as-is) |
| `FIRESTORE_EMULATOR_HOST` | No | — | e.g. `localhost:8080` — point at a local Firestore emulator instead of production |

Getting Firebase credentials: Firebase Console → Project Settings → Service Accounts → **Generate
new private key**. You then have two ways to get that JSON into the app — see
`src/config/env.ts` for the Zod rule that enforces exactly one of them is present:

1. **Discrete env vars** (the default in `.env.example`): map the JSON's `project_id` /
   `client_email` / `private_key` fields straight into `FIREBASE_PROJECT_ID` /
   `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`. Works fine as a plain Render environment
   variable — Render supports multi-line values, so the `\n`-embedded private key doesn't need
   any special handling.
2. **Service-account file** (`FIREBASE_SERVICE_ACCOUNT_PATH`): add the whole downloaded JSON as a
   Render **Secret File** (Dashboard → Environment → Secret Files), which Render mounts at
   `/etc/secrets/<filename>` inside the container, then set
   `FIREBASE_SERVICE_ACCOUNT_PATH=/etc/secrets/<filename>`. Nothing about the key ever needs
   escaping or quoting with this option.

`src/config/firebase.ts` picks whichever strategy is configured and initializes the Admin SDK
singleton from it. `src/services/firestore.service.ts` exposes the resulting `db` (Firestore)
instance plus a generic `FirestoreService<T>` wrapper (`findById`, `findAll`, `create`, `update`,
`delete`) that resource-specific services extend for a specific collection.

## Running Locally

```bash
npm run dev
```

Starts the server with hot reload (`tsx watch`) against `src/server.ts`. Once running, confirm
it's up with `curl http://localhost:3000/health` (the bare platform health check) or
`curl http://localhost:3000/api/health` (the richer application health check).

Other scripts:

- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run the compiled build (`node dist/server.js`) — use this after `npm run build`,
  not for day-to-day development
- `npm run lint` / `npm run lint:fix` — ESLint
- `npm run format` / `npm run format:check` — Prettier
- `npm run typecheck` — type-check without emitting

## Running Tests

```bash
npm test               # run once
npm run test:watch     # re-run on change
npm run test:coverage  # with a coverage report
```

Tests never touch real Firestore or the network:

- **`src/test-utils/fakeFirestore.ts`** — an in-memory stand-in for the slice of the Firestore
  Admin SDK this app uses (`where`/`orderBy`/`limit`/`startAfter`/`get`/`stream`/`add`/`batch`).
  `FirestoreService` and `AutomobileService` both accept an optional `Firestore` instance in their
  constructor (defaulting to the real singleton) specifically so tests can inject this fake.
- **`jest.setup.js`** (via `setupFiles`) sets dummy-but-schema-valid `FIREBASE_*` env vars before
  any module loads, since importing `automobile.service.ts` transitively initializes the Firebase
  Admin SDK even when the Firestore calls themselves are faked or mocked out.

Layers, and what each one actually exercises:

| Test file | What it covers | Firestore boundary |
| --- | --- | --- |
| `services/firestore.service.test.ts` | Generic CRUD wrapper (`create`/`findById`/`findAll`/`update`/`delete`) | Fake Firestore (real query logic) |
| `services/automobile.service.test.ts` | `AutomobileService`'s real query-building: pagination/cursors, prefix search, filters, price ranges, the q+price-range 400, CSV export streaming | Fake Firestore (real query logic) |
| `controllers/automobile.controller.test.ts` | HTTP glue only — reads `req.validated`, status codes, 404 shaping, calling the right service method | `automobile.service` module mocked |
| `middleware/validate.test.ts` | Schema parsing onto `req.validated`, partial schema sets, `ZodError` forwarded to `next()` on failure | n/a |
| `middleware/errorHandler.test.ts` | `ApiError` → its status code, `ZodError` → 400 + issues, malformed-JSON `SyntaxError` → 400, unrecognized error → 500, the `headersSent` guard | n/a |
| `middleware/requestId.test.ts` | Mints a UUID when absent, reuses/echoes an inbound `X-Request-Id`, takes the first value if sent multiple times | n/a |
| `utils/apiResponse.test.ts` | `sendSuccess` envelope shape and status code override | n/a |
| `src/app.test.ts` (Supertest) | Full request/response cycle through the real Express app: routing, envelope shape, Zod validation → 400, malformed JSON body → 400, `X-Request-Id` correlation end-to-end, CSV response headers/streaming, the bare `/health` route, unmatched-route 404 | `automobile.service` module mocked |
| `src/scripts/import-automobile-data.test.ts` | Missing-value/numeric/word-to-number conversion, row validation, `parseArgs`, and `run()` end-to-end against a temp CSV (batching, `--dry-run`, `--collection`) | Fake Firestore (real batching logic) |

Not yet covered by a dedicated test: the CORS-origin comma-splitting in `config/index.ts` and the
Firebase credential-strategy selection in `config/firebase.ts` (both added for this Render pass) —
they're exercised indirectly (every test run boots the app through one strategy or the other) but
don't have their own assertions yet.

`run()` in the import script takes an optional `Firestore` and `argv` and returns an
`{ totalRows, imported, skipped }` summary, so tests can call it directly instead of shelling out;
the script only auto-executes when run as a CLI (`if (require.main === module)`), not on import.

## Docker

The `Dockerfile` is a 4-stage build — `deps` (installs everything, incl. devDependencies, so
`tsc` is available) → `build` (compiles `src/` to `dist/`) → `prod-deps` (a clean install with
`--omit=dev`, independent of the build stage) → `runner` (alpine + only `dist/` + only production
`node_modules`, running as the non-root `node` user). No source, TypeScript, devDependencies, or
test files end up in the final image.

```bash
docker build -t firehawk-backend .
docker run --rm -p 3000:3000 --env-file .env firehawk-backend
```

- **Environment variables**: nothing secret is baked into the image. `NODE_ENV=production` and a
  default `PORT=3000` are set in the Dockerfile itself (Render overrides `PORT` at runtime for
  Docker services — that's expected, see Environment Variables above); everything else must be
  supplied at `docker run` time via `--env-file .env`, `-e KEY=value`, or your orchestrator's
  secret store. `src/config/env.ts` still validates all of it with Zod at startup, so a
  misconfigured container fails fast with a clear error rather than serving traffic in a broken
  state.
- **Image size**: alpine base + production-only deps. `firebase-admin` (which pulls in
  `@google-cloud/firestore` and its gRPC bindings) is by far the largest contributor and isn't
  something a Dockerfile can shrink further — that's the actual cost of talking to Firestore.
- **Health check**: the image's `HEALTHCHECK` polls the bare `GET /health` — `docker ps`,
  Render, and other orchestrators use this to know when the container is actually ready, not just
  that the process started.

⚠️ Both stages use `npm install`, not `npm ci` — see the lockfile note under Installation. This is
why the image built and deployed successfully despite the lockfile drift; it's a workaround, and
`npm ci` should be restored once the lockfile is regenerated.

## Deploying to Render

`.render.yaml` is a Render Blueprint that declares this service: `runtime: docker` (builds and
runs the `Dockerfile` above, so nothing about the runtime environment needs reconfiguring),
`healthCheckPath: /health` (points Render's own health check at the bare endpoint, not the
enveloped `/api/health`), and every secret-shaped env var marked `sync: false` so Render prompts
for the real value in the dashboard/CLI instead of it ever being committed to this file.

To deploy: push this repo, then in Render either **New → Blueprint** and point it at the repo
(it'll read `.render.yaml` automatically), or **New → Web Service** and configure it by hand
(runtime: Docker, health check path: `/health`) if you'd rather not use a Blueprint. Either way,
fill in the `FIREBASE_*` / `CORS_ORIGIN` values in the dashboard's Environment tab — see
Environment Variables above for what each one needs and the two supported Firebase credential
strategies (plain env vars vs. a Secret File).

A few things that make this app work correctly on Render specifically, already true without
further changes:

- **Binds to `PORT` from the environment**, whatever Render assigns it (`config/env.ts`), and to
  all interfaces by default (Express's `app.listen(port)` with no host argument) — Render routes
  traffic to whatever the container's `PORT` is set to, on any interface.
- **Graceful shutdown**: Render sends `SIGTERM` before stopping/replacing a container on every
  deploy or scaling event; `server.ts` already handles it (`server.close()`, then exit) so
  in-flight requests finish instead of being dropped mid-response.
- **Fails fast on misconfiguration**: if a required env var is missing, `config/env.ts`'s Zod
  validation throws at startup — Render will show the container as failing to become healthy
  rather than silently serving broken responses.

## Importing the Dataset

`src/scripts/import-automobile-data.ts` loads the classic UCI "Automobile" (imports-85) dataset
into Firestore. It streams the CSV, validates and type-converts each row with `zod`, treats
blank cells and the dataset's `?` marker as missing values, and writes in batches (capped at
Firestore's 500-operation limit) so imports of any size stay within quota.

Place your full CSV at `data/automobile.csv` (gitignored — bring your own copy) or point at any
path with `--file`. A small `data/automobile-sample.csv` fixture (5 rows, including missing
values) is committed for smoke-testing.

```bash
# Validate + preview without writing to Firestore
npm run import:automobile -- --file=data/automobile-sample.csv --dry-run

# Real import
npm run import:automobile -- --file=data/automobile.csv --collection=automobiles
```

Flags: `--file` (CSV path), `--collection` (Firestore collection name, default `automobiles`),
`--batch-size` (default/max 500), `--dry-run` (validate and log without committing writes).
Rows that fail validation are logged and skipped; the run ends with a summary of
total/imported/skipped row counts.

## API Endpoints

Every JSON response — success or error — follows the same envelope, and every request is
traceable end to end via a correlation id:

- **Consistent responses.** Success responses are always `{ success: true, data }`, built with
  `sendSuccess(res, data)` (`src/utils/apiResponse.ts`) — never a raw `res.json(...)`. Error
  responses are always `{ success: false, error: { message, requestId, ... } }`.
- **Centralized validation.** Routes attach `validate({ params?, query?, body? })`
  (`src/middleware/validate.ts`) with Zod schemas defined in `src/models/`; the parsed,
  type-coerced result lands on `req.validated` (see `src/types/express.d.ts`) instead of Express's
  raw `req.query`/`req.params`. Controllers read from `req.validated` and never call `.parse()`
  themselves — validation is a route-level concern, not scattered across handlers. A failed schema
  throws a `ZodError`, which bubbles to the centralized error handler and comes back as a 400.
- **Centralized error handling.** Every thrown/rejected error — from a controller, a service (e.g.
  `AutomobileService`'s `ApiError(400, ...)` when a search and a price range are combined), a
  failed `validate()` schema, or malformed JSON in the request body — flows through the single
  `errorHandler` middleware (`src/middleware/errorHandler.ts`), which maps each case to the right
  status code and the same error envelope. It also guards against writing a second response once
  a streaming reply (like CSV export) has already started sending data.
- **Request logging & correlation.** `requestId` (`src/middleware/requestId.ts`) reuses an inbound
  `X-Request-Id` header or mints a UUID, sets it as `req.id`, and echoes it back as a response
  header. Morgan (`src/app.ts`) then logs one access-log line per request via a custom `:id` token
  that reads `req.id`, so every log line is tagged with the same correlation id that shows up in
  the error envelope — a client-reported error and its server log line can always be matched up.
  (Registered after the bare `/health` route, so high-frequency health-check pings don't flood
  the logs.)

### Health

Two endpoints, for two different audiences: `/health` is what Render/Docker/orchestrators poll —
minimal, dependency-free, unlogged. `/api/health` is for application consumers and follows the
same conventions (envelope, logging) as the rest of the API.

| Method | Route | Description |
| --- | --- | --- |
| GET | `/health` | `{ "status": "ok" }` — no envelope. Render's/Docker's health check target |
| GET | `/api/health` | `{ success: true, data: { status: 'ok', uptime, timestamp } }` |

### Cars (automobiles)

Split across the layers described above: `models/automobile.model.ts` holds the domain type plus
the Zod schemas, `routes/automobile.routes.ts` attaches them via `validate({...})`,
`controllers/automobile.controller.ts` reads the already-validated result off `req.validated` and
shapes the response with `sendSuccess`, and all Firestore querying, filtering and pagination logic
lives in `services/automobile.service.ts`'s `AutomobileService`, which extends the generic
`FirestoreService<T>` for the `automobiles` collection.

| Method | Route | Description |
| --- | --- | --- |
| GET | `/api/cars` | Paginated, searchable, filterable, sortable list — see below |
| GET | `/api/cars/:id` | Single record, 404 if missing |
| GET | `/api/cars/search` | Alias of `/api/cars` (same handler, same params) — kept for backward compatibility |
| GET | `/api/cars/export` | Streams the (optionally filtered/sorted) result set as a CSV download |

`/api/cars`, `/api/cars/search` and `/api/cars/export` all accept the same query params:

- **Filtering**: `make`, `fuelType` (`gas`/`diesel`), `aspiration` (`std`/`turbo`), `bodyStyle`,
  `driveWheels`, `engineLocation` (all exact match), plus `minPrice`/`maxPrice` (a range on
  `price`).
- **Searching**: `q` — a case-insensitive prefix match on `make` (e.g. `q=por` matches
  "porsche").
- **Sorting**: `sortBy` (one of `make`, `price`, `cityMpg`, `highwayMpg`, `horsepower`,
  `symboling`) and `sortOrder` (`asc`, default, or `desc`).
- **Pagination**: `limit` (page size, default 20, max 100) and `cursor` (the `nextCursor` from
  the previous page).

Two combinations return a 400 instead of a raw Firestore error, both for the same underlying
reason — Firestore allows only one range (inequality) filter per query, and forces the first
`orderBy` to match whichever field that filter is on:

- `q` + a price range (`minPrice`/`maxPrice`) — the `q` prefix match already occupies the one
  allowed range filter, on `make`.
- `sortBy` set to anything other than the field a range filter already forces the order onto
  (`make` for `q`, `price` for a price range) — e.g. `q=por&sortBy=price` is rejected, but
  `q=por&sortBy=make` is fine since it agrees with the forced order.

`/cars` and `/cars/search` respond with `{ success: true, data: { data, nextCursor, hasMore } }`.
`/cars/export` has no pagination and no envelope — it streams every matching row (respecting
`sortBy`/`sortOrder`) as a raw `text/csv` file download
(`Content-Disposition: attachment; filename="automobiles.csv"`), so it stays memory-efficient even
for a large result set.

The service's underlying `getAll()`, `search()` and `filter()` methods remain independently
callable (e.g. from other services or tests); `query()` is the combined entry point the
`/cars/search` route uses to dispatch between them based on which params are present.
