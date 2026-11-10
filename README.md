# Exam Command Center 2026: cloud upgrade kit

## 1. Supabase
1. Create a project at supabase.com. Auth > Providers > Email: turn OFF "Confirm email" and **turn OFF "Allow new users to sign up"**.
2. SQL Editor: run `supabase/migrations/001_init.sql`.
3. Auth > Users > Add user: email `golee@examcc.app` (any address works as an internal login id), password = your initial password.
   Type it only into the dashboard. It is never in code or Git. The login screen maps the username "Golee" to this email.
   Set `must_change_password = true` (default); after first login the app must call `sb.auth.updateUser({password})`
   then `update profiles set must_change_password=false`.
4. Auth > URL config: add your Vercel URL as the Site URL.

## 2. Push (VAPID)
```
npx web-push generate-vapid-keys
supabase login && supabase link --project-ref YOURREF
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=$(openssl rand -hex 24) APP_URL=https://YOUR.vercel.app
supabase functions deploy notify --no-verify-jwt
```
(`--no-verify-jwt` because cron calls with a secret; the function checks the cron secret or the user's JWT itself.)

## 3. Scheduler (every minute, IST logic is inside the function)
Run in SQL editor, replacing both placeholders:
```sql
create extension if not exists pg_cron; create extension if not exists pg_net;
select cron.schedule('ecc-notify','* * * * *',$$
 select net.http_post(url:='https://YOURREF.supabase.co/functions/v1/notify',
  headers:='{"x-cron-secret":"YOUR_CRON_SECRET","Content-Type":"application/json"}'::jsonb, body:='{}'::jsonb) $$);
```

## 3b. Client calls
- Task completed: update `tasks` (done=true, done_at=now()), then `sb.functions.invoke('notify',{body:{type:'task_done',task_id}})`.
- Test button: `{type:'test'}`. Study session: `{type:'session_done',session_id}`.

## 4. PWA / iOS
Put `public/*` in your site root, paste `head-snippet.html` into `<head>`, and add icons `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (180x180).
On iPhone/iPad (iOS/iPadOS 16.4+): Safari > Share > Add to Home Screen > open the Home Screen icon > Settings > "Enable notifications" (button calls `enablePush`).
Push on iOS only works from the installed Home Screen app, not from a normal Safari tab.

## 5. Vercel + GitHub
`git init && git add . && git commit -m init`, push to a **private** GitHub repo, import it in Vercel, add the three `VITE_*` env vars, deploy.
Never add the service-role key, VAPID private key or password to Vercel frontend vars or Git.

## Not done in this kit
Frontend wiring (login screen, supabase-js sync of `app_state`, offline queue, realtime subscribe) and on-device testing.
