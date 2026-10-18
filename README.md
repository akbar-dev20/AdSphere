# AdSphere frontend starter

This is a fresh React/Vite frontend intended to connect to your **existing** Supabase project. It does not create, alter, or delete database tables.

## 1. Requirements
- Node.js 20+ recommended
- Existing Supabase project URL and publishable/anon key
- Your verified schema and RLS policies for `company`, `advRec`, `ad_plan_prices`, and `ad_subscriptions`

## 2. Run locally
```bash
npm install
cp .env.example .env
npm run dev
```
On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp` if needed.
Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`, then restart the dev server.

## 3. Current state
- Responsive public homepage and three tier sections
- Search and category filtering
- Card image fallbacks and details modal
- Login and registration via Supabase Auth
- Protected dashboard shell
- Plans UI placeholder; no payments are processed
- Demo cards are shown until live schema mapping is verified

## 4. Important database integration notes
`src/services/advertisements.js` has `LIVE_MODE = false` on purpose. Do not enable it until you verify the actual column names and map `normalizeRecord()` and the query to the schema. The adapter currently uses `select("*")` as a temporary inspection-friendly query and does not apply real subscription expiry logic.

`src/services/companies.js` creates a Supabase Auth user, but does not insert a row into `public.company` because the exact required columns, Auth-user relationship, and RLS policy are not yet confirmed.

Advertisement creation is intentionally disabled until the exact `advRec` insert fields and RLS rules are verified. Subscription prices are placeholders and no payment is taken.

Never put a Supabase service-role key or database password in a `VITE_*` variable. Frontend keys are public; enforce access with Row Level Security.

## 5. Next schema-mapping step
In Supabase SQL Editor, run read-only inspection queries and share the results (remove personal data):
```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('company', 'advRec', 'ad_plan_prices', 'ad_subscriptions')
order by table_name, ordinal_position;
```
To inspect RLS policy definitions:
```sql
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('company', 'advRec', 'ad_plan_prices', 'ad_subscriptions')
order by tablename, policyname;
```
These are read-only queries; they do not modify your data.
