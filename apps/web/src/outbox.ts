// Field reports wait here (IndexedDB) until there is a signal. Each carries its own id, so sending it twice is harmless.
// Each also carries the account that filed it and goes out only while that account is signed in: the server files a
// report under the session that sends it, so after "Lihat sebagai" or a sign-in as someone else a waiting report would
// go out in the other account's name and scope (a real check becoming a shared demo one, or the other way round). The
// session code says who is signed in (session.tsx).
import { createStore, del, get, keys, set } from 'idb-keyval';
import type { Status } from './api';

export interface QueuedReport {
  clientUuid: string; incidentId: string; incidentLabel: string; status: Status; falseAlarmKind?: string; note: string;
  latitude: number | null; longitude: number | null; accuracyM: number | null; observedAt: string; photo: Blob | null;
  queuedAt: string; attempts: number; lastError: string | null; rejected: boolean;
  /** The account that filed it. A report saved before accounts were recorded has none and goes out with any account. */
  userId?: string;
}

const store = typeof indexedDB === 'undefined' ? null : createStore('titikapi-outbox', 'reports');
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
export const onOutboxChange = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/**
 * Who is signed in here, as the session code last said: undefined until it has said (the session check has not
 * finished), null for a visitor. Nothing goes out unless an account is signed in.
 */
let account: string | null | undefined;
/** Sign-ins and sign-outs under way (holdOutbox): the session cookie may change any moment, so nothing goes out. */
let holds = 0;
/** The server answered 401 (no session): nothing goes out until an account signs in again. */
let signedOut = false;
/** startOutboxSync's retry, run when an account may send again. */
let resume: (() => void) | null = null;
const sessionEnded = new Set<() => void>();

/** The account reports may go out under now, or null when none may. */
const sender = () => (holds || signedOut || !account ? null : account);

/**
 * Whether `report` goes out under the account `id`: filed by it, or saved before accounts were recorded. Never under a
 * visitor (null), who cannot file one.
 */
export const belongsTo = (report: QueuedReport, id: string | null) => id !== null && (report.userId === undefined || report.userId === id);

/**
 * Tells the outbox who is signed in (null: nobody): what the session check or a sign-in answered, or the account kept
 * from the last visit while there is no signal. An account signing in also ends the wait after a 401.
 */
export function setOutboxAccount(id: string | null) {
  account = id;
  if (id) signedOut = false;
  notify();
  resume?.();
}

/**
 * Holds the outbox while a sign-in or sign-out is under way, from before its request until the session code has said
 * who is signed in: a report sent meanwhile could go out under the next account. The function it returns lets go,
 * also when the attempt failed and nothing changed.
 */
export function holdOutbox(): () => void {
  holds++;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holds--;
    resume?.();
  };
}

/** True after the server said the session has ended (401), until an account signs in. */
export const outboxSignedOut = () => signedOut;

/** Calls `listener` when a report met a 401: the session has ended, though this browser still shows the account. */
export const onSessionEnded = (listener: () => void) => { sessionEnded.add(listener); return () => { sessionEnded.delete(listener); }; };

export async function queued(): Promise<QueuedReport[]> {
  if (!store) return [];
  const ids = await keys(store);
  const items = await Promise.all(ids.map(id => get<QueuedReport>(id, store)));
  return items.filter((item): item is QueuedReport => Boolean(item)).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

/** Saves a report to send. Its account is the one given (the field check page's), else the one the session last said. */
export async function enqueue(report: Omit<QueuedReport, 'queuedAt' | 'attempts' | 'lastError' | 'rejected'>) {
  const { userId = account ?? undefined, ...rest } = report;
  await set(report.clientUuid, { ...rest, ...(userId ? { userId } : {}), queuedAt: new Date().toISOString(), attempts: 0, lastError: null, rejected: false }, store!);
  notify();
}

export async function discard(clientUuid: string) { await del(clientUuid, store!); notify(); }

/** What one account sees of the outbox; `viewer` null for a visitor, who has none of its own. */
export interface OutboxView {
  /** Its reports still to be sent, oldest first (and those saved before accounts were recorded). */
  waiting: QueuedReport[];
  /** Its reports the server refused for good. */
  rejected: QueuedReport[];
  /** Reports waiting for another account, the one that filed them, to sign in again; their details stay theirs. */
  others: number;
}
export function outboxView(items: QueuedReport[], viewer: string | null): OutboxView {
  const own = items.filter(item => belongsTo(item, viewer));
  return {
    waiting: own.filter(item => !item.rejected),
    rejected: own.filter(item => item.rejected),
    others: items.filter(item => !belongsTo(item, viewer) && !item.rejected).length,
  };
}

export type Sender = (report: QueuedReport) => Promise<Response>;
export const sendReport: Sender = report => {
  const form = new FormData();
  form.set('clientUuid', report.clientUuid);
  form.set('status', report.status);
  if (report.falseAlarmKind) form.set('falseAlarmKind', report.falseAlarmKind);
  if (report.note) form.set('note', report.note);
  if (report.latitude !== null && report.longitude !== null) { form.set('latitude', String(report.latitude)); form.set('longitude', String(report.longitude)); }
  if (report.accuracyM !== null) form.set('accuracyM', String(Math.round(report.accuracyM)));
  form.set('observedAt', report.observedAt);
  if (report.photo) form.set('photo', report.photo, 'foto.jpg');
  return fetch(`/api/v1/incidents/${report.incidentId}/verifications`, { method: 'POST', body: form, credentials: 'same-origin' });
};

export interface FlushResult { sent: number; left: number }
let flushing: Promise<FlushResult> | null = null;
/**
 * Sends what the signed-in account has waiting, oldest first; other accounts' reports wait. Stops at the first network
 * failure; a report the server rejects is kept and marked. A 401 (no session) rejects nothing: the reports wait until
 * an account signs in again.
 */
export function flush(send: Sender = sendReport): Promise<FlushResult> {
  if (flushing) return flushing;
  const pass = (async () => {
    let sent = 0;
    try {
      for (const report of await queued()) {
        // Asked before each report: the account may change while one is on its way.
        const id = sender();
        if (!id) break;
        if (report.rejected || !belongsTo(report, id)) continue;
        let response: Response;
        try { response = await send(report); } catch {
          await set(report.clientUuid, { ...report, attempts: report.attempts + 1, lastError: 'Belum ada sinyal' }, store!);
          break;
        }
        if (response.ok) { await del(report.clientUuid, store!); sent++; continue; }
        const body = await response.json().catch(() => null);
        const ended = response.status === 401;
        const retry = ended || response.status >= 500 || response.status === 408 || response.status === 429;
        await set(report.clientUuid, { ...report, attempts: report.attempts + 1, lastError: body?.error?.message ?? `Gagal (${response.status})`, rejected: !retry }, store!);
        if (ended) { signedOut = true; sessionEnded.forEach(listener => listener()); }
        if (retry) break;
      }
    } finally {
      notify();
    }
    return { sent, left: (await queued()).filter(report => !report.rejected).length };
  })();
  flushing = pass.finally(() => { flushing = null; });
  return flushing;
}

/**
 * Retries whenever the browser says it is back online, on start, every 20 seconds while the signed-in account has
 * something waiting, and as soon as an account may send again (it signed in, or a sign-in finished).
 */
export function startOutboxSync() {
  const tick = () => {
    if (navigator.onLine === false || !sender()) return;
    void queued().then(items => {
      const id = sender();
      if (id && items.some(item => !item.rejected && belongsTo(item, id))) void flush();
    }).catch(() => {});
  };
  // After the pass under way, if any: one that began under the last account stops at its next report.
  const again = () => { void (flushing ?? Promise.resolve()).catch(() => null).then(tick); };
  window.addEventListener('online', tick);
  const timer = window.setInterval(tick, 20_000);
  resume = again;
  tick();
  return () => { window.removeEventListener('online', tick); window.clearInterval(timer); if (resume === again) resume = null; };
}

/** Shrinks a camera photo before it waits offline or travels over a weak signal. */
export async function compressPhoto(file: File, maxSide = 1600, quality = 0.8): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('encode'))), 'image/jpeg', quality));
  } catch { return file; }
}
