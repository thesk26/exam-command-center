// Call from a button click (iOS requires an explicit user gesture). `sb` = supabase-js client, VAPID_PUBLIC = base64url public key.
export async function enablePush(sb, VAPID_PUBLIC) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Push is not supported here. On iPhone/iPad, install to Home Screen first (iOS 16.4+).");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications were denied. Re-enable them in Settings > Notifications.");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const b64 = VAPID_PUBLIC.replace(/-/g, "+").replace(/_/g, "/");
  const key = Uint8Array.from(atob(b64 + "=".repeat((4 - b64.length % 4) % 4)), c => c.charCodeAt(0));
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const j = sub.toJSON(), { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from("push_subscriptions").upsert({ user_id: user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent }, { onConflict: "endpoint" });
  if (error) throw error;
}
export async function disablePush(sb) {
  const reg = await navigator.serviceWorker.getRegistration(), sub = await reg?.pushManager.getSubscription();
  if (sub) { await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
}
