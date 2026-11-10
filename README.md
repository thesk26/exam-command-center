# Exam Command Center 2026: cloud upgrade kit

## 1. Supabase
1. Create a project at supabase.com. Auth > Providers > Email: turn OFF "Confirm email" and **turn OFF "Allow new users to sign up"**.
2. SQL Editor: run `001_init.sql` from this repository.
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

## 4. Frontend
The Vite app provides password sign-in, today's task list, exam countdowns, and a focus timer. For local development, run `npm install` followed by `npm run dev`. Build with `npm run build`.
Push permission and offline/realtime sync are not wired into the frontend yet.

## 5. Vercel + GitHub
The repository is `https://github.com/thesk26/exam-command-center`. Import it in Vercel, use the default Vite build settings (`npm run build`, output `dist`), and add `VITE_SUPABASE_URL` plus `VITE_SUPABASE_ANON_KEY` as environment variables before deploying. The app displays setup instructions if either is missing.
Never add the service-role key, VAPID private key, cron secret, or password to Vercel frontend vars or Git. Add the deployed Vercel URL to Supabase Auth URL configuration.

## Not done in this kit
Push permission/device management, offline queue, realtime sync of `app_state`, and on-device testing.
