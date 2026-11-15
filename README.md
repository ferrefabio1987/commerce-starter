# Commerce Starter

A white-label e-commerce starter for **one independent store per deployment**:
Medusa 2 backend and Admin, a Next.js storefront, PostgreSQL, Redis and Docker.
Clone it, change the configuration, run the seed, deploy. No application code changes needed.

It is built on the official [Medusa DTC starter](https://github.com/medusajs/dtc-starter)
(imported at commit `44f2979`, see `.upstream-commit`) and keeps its structure, workflows and SDK usage.
Everything the starter already does (catalog, search, cart, checkout, accounts, orders) is reused as-is.

> Not a multi-tenant platform. There are no tenant IDs and no tenant resolution. Each store gets its own
> database, backend, storefront and infrastructure.

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Architecture](#2-architecture)
3. [Installation](#3-installation)
4. [Local development](#4-local-development)
5. [Minimal seed](#5-minimal-seed)
6. [Demo seed](#6-demo-seed)
7. [Branding customization](#7-branding-customization)
8. [Storefront configuration](#8-storefront-configuration)
9. [Medusa Admin](#9-medusa-admin)
10. [Payment providers](#10-payment-providers)
11. [Production deployment](#11-production-deployment)
12. [Environment variables](#12-environment-variables)
13. [Troubleshooting](#13-troubleshooting)
- [Guide: launch a new branded store](#guide-launch-a-new-branded-store)
- [Testing](#testing)
- [Divergence from the upstream starter](#divergence-from-the-upstream-starter)
- [Verification status and known limitations](#verification-status-and-known-limitations)

---

## 1. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 22.23.4+ (LTS; 24 tested) | Medusa requires 22.23.4 or newer |
| pnpm | 10.x (pinned `10.32.1` in `package.json`) | `corepack enable` installs it. Root scripts are run with `npm run`, which calls pnpm |
| Docker + Compose v2 | Docker 24+ | Local PostgreSQL/Redis, production images |
| Git | any | |

## 2. Architecture

```
commerce-starter/
├── apps/
│   ├── backend/            Medusa 2 server + Admin (upstream, @store/backend)
│   │   ├── medusa-config.ts    env validation, Redis/S3/Stripe modules
│   │   ├── src/scripts/seed.ts minimal + demo presets
│   │   └── integration-tests/  seed tests (Jest)
│   └── storefront/         Next.js 16 App Router (upstream, @store/storefront)
│       ├── store.config.ts     branding, theme, layout, homepage, feature flags
│       └── public/             favicon, logo files
├── seeds/
│   ├── minimal/store.json  store, region, taxes, stock location, shipping, API key
│   └── demo/               categories.json, collections.json, products.json, assets/
├── deploy/                 production Dockerfiles, compose stack, Caddyfile, env template
├── scripts/                seed wrapper, clean-install acceptance test
├── tests/smoke.test.mjs    storefront + cart + checkout smoke test
├── docker-compose.yml      local PostgreSQL + Redis
└── .env.example            single env file for local development
```

```
                 HTTPS (Caddy)
   browser ──► shop.example.com ──► storefront (Next.js, :8000) ──┐ server-side SDK calls
          └──► api.example.com  ──► server (Medusa API + Admin, :9000) ◄┘ (http://server:9000)
                                         │            ▲
                                  PostgreSQL     Redis (events, workflows, locks)
                                         │            ▼
                                         └──── worker (subscribers, scheduled jobs, search indexing)
```

- **Medusa is the source of truth** for products, prices, inventory, regions, taxes, shipping, payments,
  customers and orders. Manage them in Medusa Admin.
- **`store.config.ts` is presentation only**: name, logo, colors, font, radius, homepage copy,
  navigation, footer, feature flags. It never contains commerce data.
- **Search** uses Medusa's native search module (PostgreSQL provider) through the upstream
  `@medusajs/instantsearch-adapter`. No external search service.
- In production the same backend image runs as `server`, `worker` and one-off `migrate`
  (Medusa's recommended split).
- Monorepo tooling is the upstream pnpm workspace + Turborepo.

## 3. Installation

```bash
git clone <your-fork-url> my-store
```

```bash
cd my-store
```

```bash
corepack enable && pnpm install
```

## 4. Local development

```bash
cp .env.example .env
```

```bash
docker compose up -d
```

```bash
npm run db:migrate
```

```bash
npm run seed -- --preset=demo
```

```bash
npm run user:create -- -e admin@example.com -p <choose-a-password>
```

```bash
npm run dev
```

| URL | What |
| --- | --- |
| http://localhost:8000 | Storefront (redirects to `/<country>`, e.g. `/de`) |
| http://localhost:9000/app | Medusa Admin |
| http://localhost:9000/health | Backend health (`OK`) |

- `docker compose up -d` starts PostgreSQL 17 and Redis 7 with named volumes, bound to `127.0.0.1` only.
- The seed writes the storefront publishable key into `.env` (`NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`) if it is empty.
  If you seed after the storefront started, restart `npm run dev`.
- Both apps read the single root `.env`. Missing or invalid variables stop the backend with a list of
  what is wrong; the storefront refuses to start without a publishable key.
- Other scripts: `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:smoke`,
  `npm run test:acceptance`, `npm run backend:dev`, `npm run storefront:dev`.

## 5. Minimal seed

```bash
npm run seed -- --preset=minimal
```

Creates the commerce infrastructure a store needs to sell, from `seeds/minimal/store.json`:

| Record | Matched on (never duplicated) |
| --- | --- |
| Store name + currencies | The single store. The name is only replaced while it is still Medusa's default ("Medusa Store"); missing currencies are added |
| Sales channel | `store.default_sales_channel_id` (Medusa creates "Default Sales Channel" on first boot) |
| Region (currency, countries, payment providers, store policies) | `metadata.seed_key`, else the region already holding the first configured country |
| Tax regions | Country code |
| Stock location | `store.default_location_id` |
| Fulfillment set + service zone | Linked to the store's default stock location |
| Shipping profile | Medusa's `default` profile |
| Shipping options | Shipping option type `code` (`standard`, `express`) inside the seeded service zone |
| Publishable API key | Any active publishable key already scoped to the sales channel |

Run it in production too: it is the only seed a real store needs.

## 6. Demo seed

```bash
npm run seed -- --preset=demo
```

Runs `minimal`, then adds example catalog data from `seeds/demo/`:
3 categories, 2 collections (`featured`, `new-arrivals`, used by the homepage), 8 products with
22 variants, EUR prices, inventory at the default stock location and product images
(uploaded through Medusa's file module, so they land in local storage or S3).

Seed guarantees:

- **Idempotent**: records are matched on Medusa-enforced unique keys (product/category/collection
  `handle`, variant `sku`, tax region country) or on references the seed owns (store defaults,
  `metadata.seed_key`, shipping option type code). Names are never used as identifiers.
- **Never overwrites**: existing records are skipped, so Admin edits survive re-runs. To re-apply a
  record from JSON, delete it in Admin first.
- **Safe**: only core-flows workflows, no SQL. All demo products are created in one workflow (rolls back on error).
- **Explicit errors**: unknown preset, invalid JSON (validated with zod), SKU already used by another
  product, unknown category/collection handle, or a country already owned by another region stop the
  seed with a non-zero exit code.
- Each run prints `created N, existing M` per record type and the publishable key.

To use your own catalog, edit or replace the JSON files. Demo data lives only under `seeds/demo/`;
nothing in the application depends on it.

## 7. Branding customization

Everything visual comes from `apps/storefront/store.config.ts` and files in `apps/storefront/public/`:

```ts
name: "Northwind Goods",
description: "Goods for the long run.",
logo: { src: "/brand/logo.svg", alt: "Northwind Goods", width: 140, height: 32 }, // or null for text
favicon: "/brand/favicon.ico",
theme: {
  colors: { primary: "#0f766e", primaryForeground: "#ffffff", secondary: "#ecfdf5", ... },
  fontFamily: '"Inter", system-ui, sans-serif',
  radius: "12px",
},
```

How theming works:

- The root layout writes the theme as CSS variables (`--brand-*`) and maps them onto the
  `@medusajs/ui-preset` variables (`--bg-base`, `--fg-base`, `--button-inverted`, `--border-interactive`, ...).
  Upstream components that use `ui-*` utilities follow the palette without edits.
- Tailwind exposes the tokens as `bg-brand`, `text-brand-fg`, `bg-brand-secondary`, `ring-brand`, and
  `rounded-md` / `rounded-lg` follow `theme.radius`.
- New UI should use these tokens instead of literal colors. Presentational components live in
  `src/modules/**`; Medusa calls stay in `src/lib/data/**`, so a future component-library swap
  (for example shadcn/ui) only touches presentation.
- Fonts: `fontFamily` is a CSS stack. To self-host a web font, load it in `src/app/layout.tsx` with
  `next/font` and reference its family in `fontFamily`.

Page titles become `<Page> | <name>`; `description` is the default meta description and footer text.

## 8. Storefront configuration

| Key | Effect |
| --- | --- |
| `home.hero` | Hero title, subtitle and call-to-action link (`cta: null` hides it) |
| `home.featuredCollections` | Medusa collection **handles** shown as product rails, in order. Handles that do not exist are skipped with a server warning |
| `nav.links` | Header links (desktop) and side-menu entries |
| `footer.columns` | Link columns; categories and collections are added automatically when `showCategories` / `showCollections` are true |
| `features.search` | Search icon in the header (the `/search` page stays available) |
| `features.customerAccounts` | Account links in header and side menu |
| `features.countrySelect` | Country/region picker in the side menu |

Policy pages (`/shipping`, `/returns`, `/terms`, `/privacy`, `/contact`) are upstream pages with
placeholder text; shipping/return numbers come from region metadata (set by the seed, editable in
Admin under Settings > Regions > Metadata). Replace the placeholder text before launch.

Storefront routes are prefixed with a country code (`/de/...`). `NEXT_PUBLIC_DEFAULT_REGION` must be
a country of one of your regions.

## 9. Medusa Admin

- URL: `<backend>/app` (local: http://localhost:9000/app).
- Create users: `npm run user:create -- -e <email> -p <password>` (locally) or
  `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production run --rm server node_modules/.bin/medusa user -e <email> -p <password>`.
- The publishable key is under Settings > Publishable API Keys.
- Products, prices, inventory, categories, collections, regions, taxes, shipping and payment providers
  are all managed here. Tax rates are not seeded: add a default rate per tax region (Settings > Tax Regions)
  if your prices exclude tax.
- Production sets secure cookies, so log in to Admin over HTTPS.

## 10. Payment providers

- **Test provider (built in, always on)**: `pp_system_default`, shown as "Manual Payment" at checkout.
  The seeded region enables it. It authorizes without charging, so it is for testing only; remove it from
  the region in Admin before going live.
- **Stripe** (integrated, needs your account):
  1. Set `STRIPE_API_KEY` and `STRIPE_WEBHOOK_SECRET` (backend) and `NEXT_PUBLIC_STRIPE_KEY` (storefront build arg).
  2. Restart the backend; the provider `pp_stripe_stripe` registers automatically.
  3. In Admin, Settings > Regions > your region: add the Stripe provider.
  4. In the Stripe dashboard, add a webhook to `<BACKEND_URL>/hooks/payment/stripe_stripe`.
  The storefront's upstream Stripe Elements checkout activates when the key is present.
- Other providers (Adyen, PayPal, ...): register the Medusa provider module in `apps/backend/medusa-config.ts`
  and enable it on the region. The storefront already supports Adyen (`NEXT_PUBLIC_ADYEN_*`, upstream).

## 11. Production deployment

One store = one compose stack (`deploy/docker-compose.prod.yml`):

| Service | Image | Role |
| --- | --- | --- |
| `caddy` | caddy:2 | Only public entry point: HTTPS (automatic Let's Encrypt), reverse proxy |
| `storefront` | `deploy/storefront.Dockerfile` | Next.js standalone server |
| `server` | `deploy/backend.Dockerfile` | Medusa API + Admin (`MEDUSA_WORKER_MODE=server`) |
| `worker` | same backend image | Subscribers, scheduled jobs, search indexing (`MEDUSA_WORKER_MODE=worker`) |
| `migrate` | same backend image | `medusa db:migrate` on every `up`, then exits; server/worker wait for it |
| `postgres`, `redis` | official | Named volumes, **no published ports** |
| `s3` (profile) | SeaweedFS | Optional self-hosted S3-compatible storage |

### First deployment

On a host with Docker, DNS records for both domains pointing at it, and ports 80/443 open:

```bash
cp deploy/.env.production.example deploy/.env.production
```

Fill in domains, URLs and secrets (`openssl rand -hex 32` for each secret). Then:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production build migrate
```

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production run --rm migrate
```

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production run --rm --no-deps server node_modules/.bin/medusa exec ./src/scripts/seed.js minimal
```

Copy the printed `pk_...` into `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` in `deploy/.env.production`, create
an admin user (section 9), then start everything:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d --build
```

Application startup never runs a seed; the demo seed is never needed in production.

### Build-time vs runtime configuration

| Where | Variables | When applied |
| --- | --- | --- |
| Backend image | none | The image is domain-independent; Admin calls the API on its own origin |
| Backend containers | everything in section 12 "Backend" | Runtime (restart to apply) |
| Storefront image | `NEXT_PUBLIC_*` (backend URL, publishable key, default region, base URL, Stripe key), `store.config.ts`, `public/` | **Build time**: rebuild the storefront image after changing them |
| Storefront container | `MEDUSA_BACKEND_INTERNAL_URL` | Runtime: server-side requests go to `http://server:9000` inside the network |

The storefront build does **not** need a running backend: pages that load commerce data render on
the first request. This is verified by building the image against an unresolvable backend URL.

Caching: Store API responses are cached by Next.js and refreshed at most every
`STOREFRONT_REVALIDATE_SECONDS` (default 60 s), so products, prices and collections edited in Admin
appear on the storefront within about a minute, without a redeploy. (Upstream cached them with no
expiry; verified fixed by the acceptance stack: an Admin rename appeared after ~70 s.)

### Updates

```bash
git pull
```

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d --build
```

`migrate` applies new migrations before `server` and `worker` start. Back up the database first (below).

### HTTPS and reverse proxy

`deploy/Caddyfile` serves `STOREFRONT_DOMAIN` and `BACKEND_DOMAIN` with automatic certificates.
Using another proxy (nginx, Traefik, a load balancer) instead: remove the `caddy` service, publish
`storefront:8000` and `server:9000` to the proxy only, forward `Host` and `X-Forwarded-Proto`,
and terminate TLS there. Keep `STOREFRONT_URL` / `BACKEND_URL` set to the public `https://` URLs
(they drive CORS, Admin and image URLs).

### Media storage

- Default: uploads go to the `uploads` volume and are served by the backend at `BACKEND_URL/static/...`.
  Fine for a single host; back the volume up.
- S3-compatible (recommended for production): set `S3_BUCKET`, `S3_FILE_URL` (public base URL),
  `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_ENDPOINT` for non-AWS services
  (R2, Spaces, SeaweedFS, MinIO; set `S3_FORCE_PATH_STYLE=true` for self-hosted servers). The bucket must allow public reads.
- Self-hosted: start with `--profile s3` (SeaweedFS; `deploy/seaweedfs-start.sh` sets credentials,
  anonymous read and creates the bucket), use the values in `.env.production.example`, and enable the
  media site in `deploy/Caddyfile`. (The official MinIO images are no longer published on Docker Hub.)

### Secrets

- Secrets live only in `deploy/.env.production` (git-ignored) on the host; restrict it with
  `chmod 600`. Use your platform's secret store instead if available. Nothing in the repo holds credentials.
- The backend refuses to start in production without `JWT_SECRET`, `COOKIE_SECRET`, `REDIS_URL`,
  or with the development default `supersecret`. Compose refuses to start without the required values.

### Backup and restore

Database (all commerce data):

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production exec -T postgres pg_dump -U medusa -Fc medusa > backup-$(date +%F).dump
```

Restore into a fresh stack (stop `server`, `worker` and `storefront` first):

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production exec -T postgres pg_restore -U medusa -d medusa --clean --if-exists < backup.dump
```

Uploads (when not using S3):

```bash
docker run --rm -v commerce_uploads:/data -v "$PWD":/backup alpine tar czf /backup/uploads-$(date +%F).tgz -C /data .
```

The compose project is named `commerce` (override with `COMPOSE_PROJECT_NAME`), so volumes are
`commerce_postgres-data`, `commerce_uploads`, etc. With S3, use the provider's versioning/replication. Redis holds only
queues and locks; it does not need backups. Test restores regularly.

## 12. Environment variables

Local development: one root `.env` (from `.env.example`). Production: `deploy/.env.production`
(from `deploy/.env.production.example`); compose derives `DATABASE_URL`, `REDIS_URL`, the CORS
lists and `MEDUSA_BACKEND_URL` from it.

**Backend**

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string. Medusa uses SSL for any non-localhost host; append `?sslmode=disable` for a private-network database without TLS (the production compose does) |
| `REDIS_URL` | production | Enables Redis event bus, workflow engine and locking. Unset locally = in-memory |
| `JWT_SECRET`, `COOKIE_SECRET` | production | Random secrets; dev default rejected in production |
| `STORE_CORS` | yes (server) | Storefront origin(s) |
| `ADMIN_CORS`, `AUTH_CORS` | yes (server) | Admin / auth origins |
| `MEDUSA_BACKEND_URL` | recommended | Public backend URL; base for locally stored upload URLs |
| `MEDUSA_WORKER_MODE` | production | `server`, `worker` or `shared` (default, dev) |
| `DISABLE_MEDUSA_ADMIN` | production | `true` on the worker |
| `S3_*` | no | S3-compatible storage (section 11) |
| `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET` | no | Stripe provider |
| `SEEDS_DIR` | no | Seed JSON directory (default `<repo>/seeds`; `/app/seeds` in the image) |

**Storefront**

| Variable | When | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | build | Store API key (printed / written by the seed) |
| `NEXT_PUBLIC_MEDUSA_BACKEND_URL` | build | Public backend URL used by the browser |
| `NEXT_PUBLIC_DEFAULT_REGION` | build | Default country code (lowercase) |
| `NEXT_PUBLIC_BASE_URL` | build | Public storefront URL (canonical URLs, sitemap) |
| `NEXT_PUBLIC_STRIPE_KEY` | build | Stripe publishable key (optional) |
| `MEDUSA_BACKEND_INTERNAL_URL` | runtime | Backend URL for server-side requests (Docker network). Optional |
| `STOREFRONT_REVALIDATE_SECONDS` | runtime | Max age of cached Store API responses (default `60`): how quickly Admin changes appear |

**Tests**: `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD` (the Jest runner creates its own database).
**Production compose**: `STOREFRONT_DOMAIN`, `BACKEND_DOMAIN`, `STOREFRONT_URL`, `BACKEND_URL`,
`HTTP_PORT`, `HTTPS_PORT`, `POSTGRES_*`, `BACKEND_IMAGE`, `STOREFRONT_IMAGE`.

## 13. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Invalid backend environment: ...` on start | Set the listed variables (see `.env.example`) |
| Storefront exits with `Missing required environment variables NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | Run the minimal seed; it writes the key to `.env`. Then restart `npm run dev` |
| Store API returns `A valid publishable key is required` | Key missing, revoked, or not linked to a sales channel. Re-run the minimal seed (reuses or creates a linked key) |
| Storefront shows no products | Run `npm run seed -- --preset=demo`, check products are *published* and in the store's sales channel |
| Homepage shows only the hero | `home.featuredCollections` handles don't exist in Medusa (server log shows a warning) |
| `Cannot create region ...: countries ... already belong to another region` | Remove those countries from `seeds/minimal/store.json` or from the existing region |
| `SKUs already used by other products` | A different product already uses the SKU; rename it in `seeds/demo/products.json` |
| Search returns nothing right after seeding | The worker builds the index; locally `npm run dev` does it. Seeding before the first `db:migrate` logs "Search index not migrated yet" |
| Port 5432/6379 in use | Change `POSTGRES_PORT` / `REDIS_PORT` in `.env` (and `DATABASE_URL` / `REDIS_URL`) |
| Admin login loops in production | Admin must be reached over HTTPS (secure cookies) at `BACKEND_URL`, which must be in `ADMIN_CORS`/`AUTH_CORS` |
| Changed `NEXT_PUBLIC_*` or `store.config.ts` has no effect in production | Rebuild the storefront image (`up -d --build`) |
| Admin changes take a minute to show on the storefront | Expected: cached responses refresh every `STOREFRONT_REVALIDATE_SECONDS` (default 60). Lower it if needed |
| Images broken in production | Without S3, set `BACKEND_URL` correctly (upload URLs are built from it). With S3, check `S3_FILE_URL` and public read access |
| Taxes always 0 | Add tax rates to the tax regions in Admin |

---

## Guide: launch a new branded store

1. **Clone** the repository for the new store (one repo or fork per store) and install:
   `corepack enable && pnpm install`.
2. **Brand**: edit `apps/storefront/store.config.ts` (name, description, colors, font, radius, hero,
   nav, footer, flags). Put the logo and favicon in `apps/storefront/public/brand/` and reference them.
3. **Commerce basics**: edit `seeds/minimal/store.json`: store name, currency, region name and countries,
   warehouse address, shipping option names and prices. Set `NEXT_PUBLIC_DEFAULT_REGION` to one of the countries.
4. **Catalog** (optional): replace `seeds/demo/*.json` and `seeds/demo/assets/` with real products,
   or skip the demo seed and add products in Admin. Make `home.featuredCollections` match your collection handles.
5. **Try it locally**: section 4 (`cp .env.example .env`, `docker compose up -d`, `npm run db:migrate`,
   `npm run seed -- --preset=demo` or `minimal`, `npm run dev`).
6. **Deploy**: section 11 (fill `deploy/.env.production`, migrate, minimal seed, publishable key,
   admin user, `up -d --build`).
7. **Go live checklist**: real payment provider enabled on the region and the test provider removed,
   tax rates set, policy pages rewritten, S3 storage configured, backups scheduled, admin passwords strong.

No file under `apps/*/src/lib/data`, `apps/backend/src` workflows, or the checkout code needs to change.

## Testing

| Command | What it runs | Needs |
| --- | --- | --- |
| `npm run typecheck` | `tsc --noEmit` in both apps | nothing |
| `npm run lint` | `medusa lint` (backend), `eslint` (storefront) | nothing |
| `npm run build` | `medusa build` + `next build` | nothing (no backend needed) |
| `npm test` | Jest: preset validation, minimal + demo, demo re-run creates nothing, merchant edits preserved, Store API prices | local PostgreSQL (`docker compose up -d`) |
| `npm run test:smoke` | Node test runner against a running stack: pages, catalog/prices, cart add/update/remove, full checkout with `pp_system_default` | running dev stack with the demo seed |
| `npm run test:acceptance` | Production compose from empty volumes: build, migrate, minimal, demo, demo again, storefront build, HTTPS via Caddy, Admin, smoke tests, restart, persistence | Docker; host ports 8080/8443 |

## Divergence from the upstream starter

Kept small to make upstream updates easy. Changed or added relative to `medusajs/dtc-starter@44f2979`:

- **Removed**: `migration-scripts/initial-data-seed.ts` (auto-seeded on migrate), `scripts/seed-demo-products.ts`,
  the "Powered by Medusa" CTA and Medusa/Next.js icons, the upstream release-sync GitHub workflow.
- **Backend**: `medusa-config.ts` (root `.env`, validation, Redis/S3/Stripe/local-file modules,
  worker mode), `src/scripts/seed.ts`, `integration-tests/http/seed.spec.ts`, `jest.config.js` (root env, no Redis).
- **Storefront**: `store.config.ts`, `src/lib/util/theme.ts`, `modules/layout/components/store-logo`;
  config wiring in `app/layout.tsx`, nav, footer, side menu, hero, homepage, checkout header,
  register/review copy and page titles; brand tokens in `tailwind.config.js`, `globals.css`, the UI
  primitives, search form and cart badge; `lib/config.ts` + `middleware.ts` (`MEDUSA_BACKEND_INTERNAL_URL`);
  `next.config.js` (root `.env`, standalone output); `sitemap.ts` (render on request);
  `lib/data/cookies.ts` (time-based revalidation of cached Store API responses);
  lint-only fixes in `lib/data/cart.ts` and `language-select` (no behavior change).
- **Root**: package names (`@store/*`), `packageManager` pnpm 10.32.1, root scripts, `docker-compose.yml`,
  `deploy/`, `seeds/`, `scripts/`, `tests/`, `.env.example`, this README.

## Verification status and known limitations

See the bottom of this file, section "Verification log", for the exact commands and results of the
last verification run.

Implemented but **not verified** (needs your credentials or infrastructure):
Stripe payments, hosted S3 providers (AWS/R2/Spaces), the `s3` compose profile as a whole
(its SeaweedFS setup and Medusa's S3 upload path were verified separately), real-domain Let's Encrypt
certificates, email notifications (no notification provider is configured; Medusa logs instead).

Known limitations:

- Option values are listed in the order Medusa returns them (alphabetical, e.g. sizes `L, M, S, XL`).
- Tax rates are not seeded (prices shown tax-exclusive with 0 tax until rates are added in Admin).
- Some upstream popovers (country/language select, cart dropdown) keep a white background regardless of
  `theme.colors.background`; dark themes need small edits there.
- Policy pages ship placeholder text.
- The account section's browser tab title shows "Sign in" on some sub-pages (upstream metadata).
- The backend image is ~1.2 GB (full Medusa dependency tree).

## Verification log

Run on 2026-11-15, macOS arm64, Node 24, pnpm 10.32.1, Docker 29 / Compose v5, Medusa 2.22.7, Next.js 16.3.8.

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | pass (both apps) |
| Lint | `npm run lint` | pass: backend no issues; storefront 0 errors, 28 upstream warnings |
| Production build | `npm run build` | pass (`medusa build` + `next build`) |
| Storefront build without backend | `docker build -f deploy/storefront.Dockerfile` with an unresolvable backend URL | pass |
| Seed tests | `npm test` | 2/2 pass: bad preset rejected; minimal, minimal again, demo, demo again with identical record counts; Admin edit preserved; Store API EUR prices |
| Dev workflow | `cp .env.example .env`, `docker compose up -d`, `npm run db:migrate`, `npm run seed -- --preset=minimal`, `--preset=demo` ×2, `npm run dev` | pass; second demo run created 0 records |
| Smoke test (dev) | `npm run test:smoke` | 4/4 pass (pages, EUR prices, cart add/update/remove, checkout to order) |
| Browser (dev) | manual in a browser | home, product variants, cart, 4-step checkout with "Manual Payment", search, category, register, order history, rebrand via `store.config.ts` only |
| Production stack | `npm run test:acceptance` | **pass**: empty volumes, migrate, minimal seed, empty-catalog pages 200, demo seed ×2 (no duplicates), HTTPS via Caddy, Admin HTML + API login, smoke 4/4, restart all containers, orders/products/images persisted |
| Env validation | backend image started with no env / with `supersecret` | refuses to start, lists each problem |
| Catalog freshness (prod) | rename a product via Admin API on the running prod stack | visible on the storefront after ~70 s (never, before the revalidation fix) |
| S3 uploads | prod backend image + SeaweedFS, `POST /admin/uploads` | pass: file stored in the bucket, public URL returns identical bytes |
| Published ports | `docker compose -f deploy/docker-compose.prod.yml config` | only Caddy (80/443) |
