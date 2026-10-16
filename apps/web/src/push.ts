// Web Push for tasks and alerts. Failures carry a reason the page turns into text in the visitor's language.
import { api } from './api';

export type PushProblem = 'unsupported' | 'disabled' | 'denied';
export class PushError extends Error {
  constructor(public problem: PushProblem) { super(problem); }
}

const toKey = (base64: string) => {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
};

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Asks for permission, subscribes this browser and tells the server. */
export async function enablePush() {
  if (!pushSupported()) throw new PushError('unsupported');
  const { data } = await api<{ data: { enabled: boolean; publicKey: string } }>('/push/public-key');
  if (!data.enabled || !data.publicKey) throw new PushError('disabled');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PushError('denied');
  const registration = await navigator.serviceWorker.ready;
  const subscription = (await registration.pushManager.getSubscription())
    ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(data.publicKey) });
  const json = subscription.toJSON();
  await api('/me/push', { method: 'POST', json: { endpoint: json.endpoint, keys: json.keys } });
  return subscription;
}

export async function disablePush() {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await api('/me/push', { method: 'DELETE', json: { endpoint: subscription.endpoint } }).catch(() => {});
  await subscription.unsubscribe();
}

/** Sends the newest alert again as a notification to this account's devices. */
export const testPush = () => api<{ data: { delivered: number } }>('/me/push/test', { method: 'POST' });
