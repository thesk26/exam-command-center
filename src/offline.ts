import type { SupabaseClient } from "@supabase/supabase-js";

export type OfflineMutation = {
  id: string;
  userId: string;
  table: string;
  operation: "insert" | "update" | "delete";
  row?: Record<string, unknown>;
  filterColumn?: string;
  filterValue?: string;
  queuedAt: string;
};

const queueKey = "ecc_pending_mutations_v1";

function readQueue(): OfflineMutation[] {
  try {
    const stored = localStorage.getItem(queueKey);
    return stored ? JSON.parse(stored) as OfflineMutation[] : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: OfflineMutation[]) {
  localStorage.setItem(queueKey, JSON.stringify(queue));
  window.dispatchEvent(new CustomEvent("ecc-sync-queue-change", { detail: { count: queue.length } }));
}

export function pendingMutationCount() {
  return readQueue().length;
}

export function queueMutation(mutation: Omit<OfflineMutation, "id" | "queuedAt">) {
  const queue = readQueue();
  const isSameRecord = (item: OfflineMutation) => item.table === mutation.table
    && item.userId === mutation.userId
    && item.filterColumn === mutation.filterColumn
    && item.filterValue === mutation.filterValue;
  if (mutation.operation === "update") {
    const existing = [...queue].reverse().find(isSameRecord);
    if (existing) {
      existing.row = { ...existing.row, ...mutation.row };
      writeQueue(queue);
      return queue.length;
    }
  }
  queue.push({ ...mutation, id: crypto.randomUUID(), queuedAt: new Date().toISOString() });
  writeQueue(queue);
  return queue.length;
}

export async function flushOfflineMutations(client: SupabaseClient, userId: string) {
  if (!navigator.onLine) return { synced: 0, pending: readQueue().length };
  const queue = readQueue();
  const remaining: OfflineMutation[] = [];
  let synced = 0;
  for (const mutation of queue) {
    if (mutation.userId !== userId) {
      remaining.push(mutation);
      continue;
    }
    let result;
    if (mutation.operation === "insert") {
      result = await client.from(mutation.table).insert(mutation.row ?? {});
    } else {
      if (!mutation.filterColumn || mutation.filterValue === undefined) {
        remaining.push(mutation);
        continue;
      }
      let request = mutation.operation === "update"
        ? client.from(mutation.table).update(mutation.row ?? {})
        : client.from(mutation.table).delete();
      request = request.eq(mutation.filterColumn, mutation.filterValue);
      if (mutation.filterColumn !== "user_id") request = request.eq("user_id", userId);
      result = await request;
    }
    if (result.error) remaining.push(mutation);
    else synced += 1;
  }
  writeQueue(remaining);
  return { synced, pending: remaining.length };
}