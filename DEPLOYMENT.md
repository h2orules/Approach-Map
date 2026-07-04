# Deploying Approach Map to Azure

Approach Map deploys to **Azure Static Web Apps (Free tier)**: the Vite build
is served as static assets from Azure's global edge, and the six `/api/*`
routes the SPA calls are handled by SWA-managed **Azure Functions** (the
`api/` folder). Managed Functions mount at `/api` by default, so the client
code calls the exact same relative paths in dev (Vite proxy) and production.

```
                       ┌────────────────────────────────────────────┐
 Browser ── HTTPS ──▶  │  Azure Static Web App (Free)               │
                       │  ├─ /            static assets (dist/)     │
                       │  └─ /api/*       managed Functions (api/)  │
                       └───────┬────────────────────────────────────┘
                               │ server-side fetch (+ secret header for adsbx)
                               ▼
   adsbexchange (RapidAPI) · aviationapi.com · aeronav.faa.gov (CIFP, d-TPP)
   api.adsbdb.com · atis.info
```

Why this architecture (vs. App Service + Express or Container Apps):

- **$0/month** on the Free tier — no plan, storage account, or registry to pay
  for; well inside the $150/month credit budget with room to spare.
- Keeps the existing `/api/*` relative paths — the only client change was
  removing the leaked API key header.
- Built-in CI/CD fit (deployment token + GitHub Actions), PR preview
  environments, free managed SSL on custom domains.
- Known limits that are fine for this app: 45s API timeout / ~30MB payloads
  (largest proxied payload is the ~15MB d-TPP metafile, fetched once per
  28-day AIRAC cycle per user and then cached in IndexedDB), 100GB
  bandwidth/month, 250MB app size. If traffic outgrows this, upgrade in place
  to the Standard tier (~$9/month) or link a dedicated Functions app — no
  re-architecture needed.

## Secret handling

| Value | Where it lives | Why |
| --- | --- | --- |
| `ADSBX_API_KEY` (ADS-B Exchange RapidAPI key) | **Static Web App application settings** (server-side only; set via `scripts/azure/set-adsbx-key.sh`). In dev: `.env.local`, attached by the Vite proxy. | Secret. Must never be `VITE_`-prefixed — Vite inlines those into the public JS bundle. The Functions proxy attaches it as `X-RapidAPI-Key` server-side. |
| `VITE_MAPBOX_TOKEN` | GitHub Actions secret, inlined at build time | Public token by design. Restrict it to your deployment URLs (Mapbox dashboard → token → URL restrictions: `https://approachmap.aquagnomeapps.com/*` and the `*.azurestaticapps.net` default hostname). |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | GitHub Actions secret | Deployment credential for the workflow. Rotate/re-read with `scripts/azure/get-deploy-token.sh`. |

The other five upstreams (aviationapi, FAA CIFP, adsbdb, dATIS, FAA d-TPP)
are keyless; the Functions proxy exists for them because they're third-party
hosts the browser can't call cross-origin.

## One-time setup

Prerequisites: [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli)
logged in (`az login`), correct subscription selected
(`az account set --subscription <id>`).

```sh
# 1. Create the resource group + Static Web App (Bicep: infra/main.bicep)
./scripts/azure/provision.sh
#    Override defaults if desired:
#    RESOURCE_GROUP=approach-map-rg LOCATION=eastus2 APP_NAME=approach-map ./scripts/azure/provision.sh

# 2. Store the ADS-B Exchange key server-side (prompts; never touches git)
./scripts/azure/set-adsbx-key.sh
```

3. Add the two GitHub repository secrets (Settings → Secrets and variables →
   Actions): `AZURE_STATIC_WEB_APPS_API_TOKEN` (printed by `provision.sh`)
   and `VITE_MAPBOX_TOKEN`.

4. Push to `main`. The workflow
   (`.github/workflows/azure-static-web-apps.yml`) builds the SPA
   (`tsc -b && vite build`) and the Functions API (`api/` — `tsc`), then
   deploys both. Pull requests targeting `main` get ephemeral preview
   environments at a generated URL, torn down when the PR closes.

## Custom domain (approachmap.aquagnomeapps.com)

Free managed SSL is included, even on the Free tier. Subdomains validate via
CNAME:

1. In GoDaddy (aquagnomeapps.com → DNS), add:
   `CNAME  approachmap  →  <default hostname from provision.sh, e.g. gentle-sky-0abc12345.6.azurestaticapps.net>`
2. Wait for propagation (`dig +short approachmap.aquagnomeapps.com CNAME`).
3. Run `./scripts/azure/configure-custom-domain.sh` — registers the hostname
   and provisions the certificate (a few minutes).

## Azure resources provisioned

Everything is one resource in one resource group (config-as-code in
`infra/main.bicep`):

| Resource | SKU | Cost |
| --- | --- | --- |
| `Microsoft.Web/staticSites` (`approach-map`) | Free | $0/month |

Teardown: `./scripts/azure/teardown.sh` (deletes the resource group), then
remove the GitHub secrets and the GoDaddy CNAME.

## How the pieces map to the repo

| Path | Purpose |
| --- | --- |
| `api/` | Azure Functions (Node 20, TypeScript). One catch-all HTTP function `api/src/functions/proxy.ts` with route `{service}/{*path}` mirrors the dev-proxy table in `vite.config.ts`. Keep the two tables in sync. |
| `staticwebapp.config.json` | SWA runtime config: SPA fallback to `/index.html` (excluding `/api`, assets, and `public/data`), `node:20` API runtime. |
| `.github/workflows/azure-static-web-apps.yml` | CI/CD: build + deploy on push to `main`, PR previews. |
| `infra/main.bicep` | The Static Web App resource definition. |
| `scripts/azure/*.sh` | az-cli wrappers: provision, set secret, deploy token, custom domain, teardown. |

## Local development

Unchanged: `npm run dev` uses the Vite dev proxies. The only difference is
`.env.local` now uses `ADSBX_API_KEY` (no `VITE_` prefix) — the dev server
attaches the header on the proxy's server side, same as production.

To exercise the real Functions locally (optional, requires
[SWA CLI](https://azure.github.io/static-web-apps-cli/) and Azure Functions
Core Tools):

```sh
npm run build && (cd api && npm install && npm run build)
npx @azure/static-web-apps-cli start ./dist --api-location ./api
# ADSBX_API_KEY for local Functions goes in api/local.settings.json (gitignored):
#   { "IsEncrypted": false, "Values": { "ADSBX_API_KEY": "..." } }
```

## Troubleshooting

- **`/api/adsbx` returns data in dev but 401/403 in prod** — `ADSBX_API_KEY`
  app setting missing or wrong: rerun `./scripts/azure/set-adsbx-key.sh`.
- **CIFP/d-TPP fetch fails with 504** — the FAA download exceeded the proxy's
  40s budget (SWA hard limit is 45s). Retry usually succeeds; if it becomes
  chronic, link a dedicated Functions app (Standard tier) which lifts the
  timeout.
- **Deploy fails with "No matching Static Web App was found or the api key was invalid"**
  — rotate/re-fetch the token (`./scripts/azure/get-deploy-token.sh`) and
  update the GitHub secret.
- **Map tiles don't load in prod** — `VITE_MAPBOX_TOKEN` GitHub secret unset
  at build time, or the token's URL restrictions don't include the deployed
  hostname.
