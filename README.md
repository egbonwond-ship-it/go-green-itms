# GO-Green IT Service Desk

A ServiceNow-style IT service management (ITSM) app for GO-Green Technologies, built for
**Azure Static Web Apps (Free plan)** with an **Azure Functions** API and a free database:
**Supabase free Postgres** (default) or **Azure Cosmos DB free tier**.
Running cost on the free tiers: **$0**.

## What it does

| Area | Features |
| --- | --- |
| **Incidents** | Create (self-service or by an agent on behalf of a caller), category / subcategory, impact × urgency → priority matrix (1 Critical … 5 Planning), assignment group, assignee, location, contact type |
| **Workflow** | New → In Progress → On Hold → Resolved → Closed, plus Canceled. Resolving needs a resolution code and notes. The caller can confirm (close) or reopen a resolved ticket |
| **SLA** | Target resolution time per priority (P1 4h, P2 8h, P3 24h, P4 3d, P5 5d), catalog items use their delivery time. Breached tickets are flagged and listed |
| **Collaboration** | Customer-visible comments and internal work notes, plus a full audit trail of every field change |
| **Service catalog** | 11 ready-made items (laptop, M365 account, password reset, VPN, 3CX extension, CCTV footage, access card, onboarding, solar/inverter visit, network point, software). Each has its own order form. Admins can add or edit items and their questions without code |
| **Queues** | Assigned to me, Unassigned, Incidents, Requests, SLA breached, My tickets, with filters and search |
| **Dashboard** | Open incidents and requests, unassigned, mine, critical, breached, average time to resolve, 14-day opened vs resolved trend, open by priority, group and category |
| **Roles** | **User** (raise and track own tickets), **Agent** (work all tickets), **Admin** (also manage catalog and roles). Sign-in with Microsoft or GitHub via Static Web Apps built-in auth |

## Branding

Colours, fonts and the logo are in two places so they're easy to change:

- `src/brand.css` holds every colour and font token, taken from the website's own palette (all greens).
- The header loads the live logo from `https://www.go-greentechnologies.com/logo-full.svg` and falls back to
  `src/assets/logo-full.svg` (a placeholder wordmark). **Replace `src/assets/logo-full.svg` with the official file**
  so the app doesn't depend on the website.
- Fonts match the website: Space Grotesk for headings and Inter for body text (Google Fonts link in `src/index.html`).

## Project layout

```
src/                       Front end (plain HTML/CSS/JS, no build step)
  index.html, app.js, styles.css, brand.css, assets/
  staticwebapp.config.json Routes, auth rules, SPA fallback
api/                       Azure Functions (Node 20, v4 programming model)
  src/functions/api.js     Registers all HTTP routes
  src/lib/handlers.js      Business logic (tickets, workflow, catalog, users, stats)
  src/lib/store.js         Data access: Supabase, Cosmos DB, or a local JSON file
db/supabase-setup.sql      One-time Supabase table setup
  src/lib/constants.js     States, groups, categories, SLA, seed catalog
scripts/dev-server.js      Local server with fake sign-in for trying it out
```

## Run it locally (2 minutes)

Needs Node.js 20+.

```bash
npm install          # also installs the API dependencies
npm run dev          # http://localhost:4280
```

The dev server fakes sign-in: on the sign-in page type any email. **The first person to sign in becomes admin.**
Data is saved in `api/data/local-db.json`. To use your real Cosmos DB locally, set `COSMOS_CONNECTION_STRING`
before `npm run dev`.

You can also use the official emulator: `npm i -g @azure/static-web-apps-cli azure-functions-core-tools@4`,
copy `api/local.settings.example.json` to `api/local.settings.json`, then `swa start src --api-location api`.

---

## Deploy to Azure

You'll need an Azure subscription (the free account works) and this code in a GitHub repository.

### 1. Create the free database (Supabase)

1. Sign up at [supabase.com](https://supabase.com) and click **New project** (Free plan).
   Name it e.g. `go-green-itms`, set a database password (keep it safe), region **West EU (Ireland)** or closest to you.
2. When it's ready, open **SQL Editor → New query**, paste the contents of [`db/supabase-setup.sql`](db/supabase-setup.sql), click **Run**.
3. Open **Project Settings → API Keys** (or **Data API**) and note:
   - the **Project URL**, like `https://abcd1234.supabase.co`
   - the **secret** key (`sb_secret_…`), or on older projects the **service_role** key. Never put this key in front-end code.

Note: free Supabase projects pause after 7 days with no activity; open the app or the Supabase dashboard to wake it.

<details><summary>Alternative: Azure Table Storage (a few cents a month, no extra sign-ups)</summary>

```bash
az storage account create -n <uniquename> -g rg-itms -l eastus2 --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false
CS=$(az storage account show-connection-string -n <uniquename> -g rg-itms -o tsv)
az staticwebapp appsettings set -n go-green-servicedesk -g rg-itms --setting-names AZURE_TABLES_CONNECTION_STRING="$CS"
```
The app creates the `itmsrecords` table itself. When this setting is present it takes priority over Supabase and Cosmos DB.
</details>

<details><summary>Alternative: Azure Cosmos DB free tier</summary>

1. In the [Azure portal](https://portal.azure.com) choose **Create a resource → Azure Cosmos DB → Azure Cosmos DB for NoSQL → Create**.
2. Fill in:
   - **Resource group:** create one, e.g. `rg-itms`.
   - **Account name:** e.g. `gogreen-itms` (must be globally unique).
   - **Location:** the region closest to your users (e.g. *South Africa North* or *West Europe*).
   - **Capacity mode:** **Provisioned throughput**.
   - **Apply Free Tier Discount:** **Apply**. (One free-tier account per subscription: first 1000 RU/s and 25 GB are free.)
   - **Limit total account throughput:** leave ticked so you can never be billed above the free amount.
3. **Review + create**, wait for it to finish (about 5 minutes).
4. Open the account → **Settings → Keys** → copy the **PRIMARY CONNECTION STRING**.

You don't need to create a database or container. On first use the API creates database `itms` (400 RU/s shared,
inside the free 1000) and container `records` (partition key `/id`).

> Using CLI instead:
> ```bash
> az group create -n rg-itms -l westeurope
> az cosmosdb create -n gogreen-itms -g rg-itms --enable-free-tier true --default-consistency-level Session
> az cosmosdb keys list -n gogreen-itms -g rg-itms --type connection-strings --query "connectionStrings[0].connectionString" -o tsv
> ```

Then set `COSMOS_CONNECTION_STRING` instead of the Supabase variables in step 3.
</details>

### 2. Create the Static Web App

1. Push this folder to a GitHub repository (branch `main`).
2. In the portal: **Create a resource → Static Web App → Create**.
   - **Resource group:** `rg-itms`. **Name:** e.g. `gogreen-servicedesk`. **Plan type:** **Free**.
   - **Source:** GitHub → sign in → pick your organisation, repository and branch `main`.
   - **Build presets:** *Custom*. **App location:** `src`. **Api location:** `api`. **Output location:** leave empty.
3. **Review + create.** Azure commits a GitHub Actions workflow to the repo and stores the deployment token as a
   repository secret. From then on every push to `main` redeploys the app automatically (about 2 minutes).
   Watch progress in the repo's **Actions** tab.

### 3. Connect the app to the database

Static Web App → **Settings → Environment variables** → add, then **Apply**:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | the Project URL from step 1 |
| `SUPABASE_SERVICE_KEY` | the secret / service_role key from step 1 |
| `ADMIN_EMAILS` | your sign-in email, e.g. `it@go-greentechnologies.com` (comma-separate several) |
| `ALLOWED_EMAIL_DOMAINS` | *(recommended)* `go-greentechnologies.com` so only staff can sign in |

With Cosmos DB instead: `COSMOS_CONNECTION_STRING`, optional `COSMOS_DATABASE` (default `itms`), `COSMOS_CONTAINER` (default `records`).

### 4. First sign-in

1. Open the Static Web App URL from **Overview** (e.g. `https://<name>.azurestaticapps.net`).
2. **Sign in with Microsoft.** Anyone listed in `ADMIN_EMAILS` becomes admin. If you didn't set it, the very first person to sign in becomes admin.
3. Ask your IT team to sign in once, then go to **Users & roles** and make them **Agent**.
4. Optional: add a custom domain such as `support.go-greentechnologies.com` under **Settings → Custom domains** (free, with free SSL).

### Notes on sign-in

- The Free plan uses Azure's pre-configured Microsoft and GitHub sign-in, which accepts any Microsoft account.
  Set `ALLOWED_EMAIL_DOMAINS` to keep outsiders out. (GitHub sign-in returns a username, not an email, so it is
  blocked when a domain list is set. Remove the GitHub button in `src/app.js` if you don't want it.)
- To restrict sign-in to your own Microsoft Entra tenant only, upgrade the Static Web App to the **Standard** plan and
  configure a custom Entra ID provider.

## Limits of the free tiers

- Static Web Apps Free: 100 GB bandwidth/month, 2 custom domains, managed Functions API included.
- Supabase Free: 500 MB database, pauses after a week of no use. Cosmos DB free tier: 1000 RU/s and 25 GB.
  Either is plenty for tens of thousands of tickets. Lists are filtered in the API, which is fine at that scale;
  past ~20k tickets, push the filters down into the queries in `api/src/lib/store.js`.

## API reference

All routes are under `/api` and require a signed-in user.

| Method | Route | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/me` | all | current user and role |
| GET | `/meta` | all | states, groups, categories, priorities, SLA |
| GET | `/stats` | all | dashboard numbers (own tickets for users) |
| GET | `/tickets?type=&state=&priority=&group=&assignedTo=&mine=&breached=&q=` | all | list (users see their own) |
| POST | `/tickets` | all | create incident |
| GET / PATCH | `/tickets/{id}` | all / agent | view, update fields and state |
| POST | `/tickets/{id}/comments` | all | comment (`internal: true` = work note, agents only) |
| GET | `/catalog` | all | catalog items |
| POST / PUT / DELETE | `/catalog`, `/catalog/{id}` | admin | manage items |
| POST | `/catalog/{id}/order` | all | order an item, creates a REQ ticket |
| GET | `/users` | agent | users |
| PATCH | `/users/{id}` | admin | change role |
