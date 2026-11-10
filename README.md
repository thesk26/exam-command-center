# Exam Command Center 2026

## Supabase setup
1. In Supabase Auth settings, disable public email signups and email confirmation.
2. In SQL Editor, run `001_init.sql`, then `002_study_modules.sql`.
3. Create the Auth user `golee@examcc.app` and set its initial password only in Supabase. The login page maps username `Golee` to this email and forces a password change on first login (minimum 12 characters).
4. Add `https://exam-command-center-xi.vercel.app` to Auth URL Configuration as the Site URL and an allowed redirect URL.

## Vercel
The connected project deploys from GitHub `main` and uses Vite (`npm run build`, output `dist`). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel. Add `VITE_VAPID_PUBLIC_KEY` after generating a VAPID key pair. The service-role key, VAPID private key, cron secret, and account password must never go in frontend variables or Git.

## Push notifications
Generate VAPID keys locally with `npx web-push generate-vapid-keys`. Put the public key in Vercel as `VITE_VAPID_PUBLIC_KEY`. Keep the private key only in Supabase Edge Function secrets.

```powershell
npx supabase login
npx supabase link --project-ref vdtgdltdwjaqxcvlqdbn
npx supabase secrets set VAPID_PUBLIC_KEY=<public-key> VAPID_PRIVATE_KEY=<private-key> VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=<long-random-secret> APP_URL=https://exam-command-center-xi.vercel.app
npx supabase functions deploy notify --project-ref vdtgdltdwjaqxcvlqdbn
```

The function accepts authenticated user calls or a private cron header; `supabase/config.toml` disables the platform JWT gate so the function can validate both paths itself. Run this in the Supabase SQL Editor to schedule the server-side sweep, replacing the cron secret with the same secret configured above:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('ecc-notify','* * * * *',$$
 select net.http_post(
   url:='https://vdtgdltdwjaqxcvlqdbn.supabase.co/functions/v1/notify',
   headers:='{"x-cron-secret":"<long-random-secret>","Content-Type":"application/json"}'::jsonb,
   body:='{}'::jsonb)
$$);
```

## App features
The app includes protected login, mandatory first-login password change, subjects/units/topics, full-date planner, exam countdowns, focus/break timer with cloud session history, spaced revisions, PYQ and mock tracking, analytics, notification settings, hydration logging, motivation center, JSON backup/restore, offline mutation queue, and Realtime refresh.

For local development, run `npm install` and `npm run dev`. `.env.local` is ignored by Git; copy the variable names from `.env.example` and enter your project values locally.

## Remaining verification
VAPID secrets and the scheduled Supabase job must still be configured before background push delivery works. Push delivery, offline replay under real network interruption, and installation on physical iOS/iPadOS devices require end-to-end testing on those devices. The app does not claim that browser notifications work when closed until the backend scheduler is configured.
