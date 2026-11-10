import type { SupabaseClient } from "@supabase/supabase-js";

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function applicationServerKey(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export async function subscribeToPush(client: SupabaseClient, userId: string) {
  if (!vapidPublicKey) throw new Error("Push is not configured yet. Add VITE_VAPID_PUBLIC_KEY in Vercel.");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Push is not supported in this browser.");
  if (!window.isSecureContext) throw new Error("Push notifications require HTTPS.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription()
    ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(vapidPublicKey) });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("This browser returned an incomplete push subscription.");
  const { error } = await client.from("push_subscriptions").upsert({
    user_id: userId,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    user_agent: navigator.userAgent,
  }, { onConflict: "endpoint" });
  if (error) throw new Error("Could not save this device subscription.");
}

export async function unsubscribeFromPush(client: SupabaseClient) {
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const { error } = await client.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
  if (error) throw new Error("Could not remove this device from your account.");
  await subscription.unsubscribe();
}