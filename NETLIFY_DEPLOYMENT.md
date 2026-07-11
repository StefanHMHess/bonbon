# BonBon Netlify Deployment

## Build settings

- Build command: `npm run build`
- Publish directory: `dist`
- Node version: `20`

## Environment variables

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DEFAULT_HOUSEHOLD_ID`

## Supabase prerequisites

- Database schema from `supabase_schema.sql`
- Private Storage bucket `receipts`
- Edge Function `bonbon-extract-receipt`
- Function secrets:
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

## Routing

- SPA fallback is handled by `public/_redirects`
