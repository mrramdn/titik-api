// Field reports wait here (IndexedDB) until there is a signal. Each carries its own id, so sending it twice is harmless.
import { createStore, del, get, keys, set } from 'idb-keyval';
import type { Status } from './api';

export interface QueuedReport {
  clientUuid: string; incidentId: string; incidentLabel: string; status: Status; falseAlarmKind?: string; note: string;
  latitude: number | null; longitude: number | null; accuracyM: number | null; observedAt: string; photo: Blob | null;
  queuedAt: string; attempts: number; lastError: string | null; rejected: boolean;
}

const store = typeof indexedDB === 'undefined' ? null : createStore('titikapi-outbox', 'reports');
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
export const onOutboxChange = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export async function queued(): Promise<QueuedReport[]> {
  if (!store) return [];
  const ids = await keys(store);
  const items = await Promise.all(ids.map(id => get<QueuedReport>(id, store)));
  return items.filter((item): item is QueuedReport => Boolean(item)).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function enqueue(report: Omit<QueuedReport, 'queuedAt' | 'attempts' | 'lastError' | 'rejected'>) {
  await set(report.clientUuid, { ...report, queuedAt: new Date().toISOString(), attempts: 0, lastError: null, rejected: false }, store!);
  notify();
}

export async function discard(clientUuid: string) { await del(clientUuid, store!); notify(); }

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

let flushing: Promise<{ sent: number; left: number }> | null = null;
/** Sends what is waiting, oldest first. Stops at the first network failure; a report the server rejects is kept and marked. */
export function flush(send: Sender = sendReport) {
  flushing ??= (async () => {
    let sent = 0;
    try {
      for (const report of await queued()) {
        if (report.rejected) continue;
        let response: Response;
        try { response = await send(report); } catch {
          await set(report.clientUuid, { ...report, attempts: report.attempts + 1, lastError: 'Belum ada sinyal' }, store!);
          break;
        }
        if (response.ok) { await del(report.clientUuid, store!); sent++; continue; }
        const body = await response.json().catch(() => null);
        const retry = response.status >= 500 || response.status === 408 || response.status === 429;
        await set(report.clientUuid, { ...report, attempts: report.attempts + 1, lastError: body?.error?.message ?? `Gagal (${response.status})`, rejected: !retry }, store!);
        if (retry) break;
      }
    } finally {
      notify();
      flushing = null;
    }
    return { sent, left: (await queued()).filter(report => !report.rejected).length };
  })();
  return flushing;
}

/** Retries whenever the browser says it is back online, on start, and every 20 seconds while something waits. */
export function startOutboxSync() {
  const tick = () => { void queued().then(items => { if (items.some(item => !item.rejected) && navigator.onLine !== false) void flush(); }); };
  window.addEventListener('online', tick);
  const timer = window.setInterval(tick, 20_000);
  tick();
  return () => { window.removeEventListener('online', tick); window.clearInterval(timer); };
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
