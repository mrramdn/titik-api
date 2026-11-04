import 'fake-indexeddb/auto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutboxLines } from './components/Shell';
import { LangProvider } from './i18n';
import type { QueuedReport, Sender } from './outbox';

type Outbox = typeof import('./outbox');
/** The outbox as a page load finds it: no account known yet. The reports themselves stay in IndexedDB. */
async function fresh(): Promise<Outbox> {
  vi.resetModules();
  return import('./outbox');
}

const report = (clientUuid: string, userId?: string) => ({ clientUuid, incidentId: 'i', incidentLabel: 'KJD', status: 'asap_bara' as const, note: '',
  latitude: null, longitude: null, accuracyM: null, observedAt: '2026-10-16T06:00:00Z', photo: null, ...(userId ? { userId } : {}) });
/** The API: answers `status` (with `message` as the error), and notes which reports reached it. */
function server(status = 201, message = '') {
  const sent: string[] = [];
  const send: Sender = async item => { sent.push(item.clientUuid); return new Response(status < 300 ? '{}' : JSON.stringify({ error: { message } }), { status }); };
  return { sent, send };
}

let outbox: Outbox;
beforeEach(async () => {
  outbox = await fresh();
  for (const item of await outbox.queued()) await outbox.discard(item.clientUuid);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('outbox', () => {
  it('keeps reports while there is no signal and sends them once it returns', async () => {
    outbox.setOutboxAccount('mpa-1');
    await outbox.enqueue(report('a'));
    await outbox.enqueue(report('b'));
    const offline = await outbox.flush(async () => { throw new TypeError('Failed to fetch'); });
    expect(offline).toEqual({ sent: 0, left: 2 });
    expect((await outbox.queued())[0]!.attempts).toBe(1);
    const api = server();
    expect(await outbox.flush(api.send)).toEqual({ sent: 2, left: 0 });
    expect(api.sent).toEqual(['a', 'b']);
  });

  it('marks a report the server rejects instead of retrying it forever', async () => {
    outbox.setOutboxAccount('mpa-1');
    await outbox.enqueue(report('c'));
    await outbox.flush(server(400, 'Status tidak valid.').send);
    const [item] = await outbox.queued();
    expect(item!.rejected).toBe(true);
    expect(item!.lastError).toBe('Status tidak valid.');
    // A role that may not file one stays rejected too.
    await outbox.enqueue(report('d'));
    await outbox.flush(server(403, 'Peran ini tidak punya akses. Masuk dengan akun yang sesuai.').send);
    expect((await outbox.queued()).find(entry => entry.clientUuid === 'd')!.rejected).toBe(true);
  });

  it('records the account that filed each report: the one given, else the one signed in', async () => {
    await outbox.enqueue(report('unknown'));
    outbox.setOutboxAccount('mpa-1');
    await outbox.enqueue(report('signed-in'));
    await outbox.enqueue(report('given', 'mpa-2'));
    const owners = Object.fromEntries((await outbox.queued()).map(item => [item.clientUuid, item.userId ?? null]));
    expect(owners).toEqual({ unknown: null, 'signed-in': 'mpa-1', given: 'mpa-2' });
  });

  it('sends nothing before the session has said who is signed in, and nothing for a visitor', async () => {
    await outbox.enqueue(report('a', 'mpa-1'));
    const api = server();
    expect(await outbox.flush(api.send)).toEqual({ sent: 0, left: 1 });
    outbox.setOutboxAccount(null);
    await outbox.flush(api.send);
    expect(api.sent).toEqual([]);
    expect((await outbox.queued())[0]!.attempts).toBe(0);
    outbox.setOutboxAccount('mpa-1');
    await outbox.flush(api.send);
    expect(api.sent).toEqual(['a']);
  });

  it('sends only the signed-in account\'s reports; another account\'s wait until it signs in again', async () => {
    // A real volunteer queues two reports, then "Lihat sebagai" moves the browser to a demo account that queues one.
    await outbox.enqueue(report('real-1', 'real-mpa'));
    await outbox.enqueue(report('demo-1', 'demo-mpa'));
    await outbox.enqueue(report('real-2', 'real-mpa'));
    outbox.setOutboxAccount('demo-mpa');
    const api = server();
    await outbox.flush(api.send);
    expect(api.sent).toEqual(['demo-1']);
    const left = await outbox.queued();
    expect(left.map(item => [item.clientUuid, item.rejected, item.attempts])).toEqual([['real-1', false, 0], ['real-2', false, 0]]);
    outbox.setOutboxAccount('real-mpa');
    await outbox.flush(api.send);
    expect(api.sent).toEqual(['demo-1', 'real-1', 'real-2']);
  });

  it('sends a report saved before accounts were recorded with whichever account is signed in, as before', async () => {
    await outbox.enqueue(report('old'));
    expect((await outbox.queued())[0]).not.toHaveProperty('userId');
    outbox.setOutboxAccount('kades-1');
    const api = server();
    await outbox.flush(api.send);
    expect(api.sent).toEqual(['old']);
  });

  it('waits after a 401 instead of rejecting the report, and sends it once its account signs in again', async () => {
    const ended = vi.fn();
    outbox.onSessionEnded(ended);
    outbox.setOutboxAccount('mpa-1');
    await outbox.enqueue(report('a'));
    await outbox.enqueue(report('b'));
    const expired = server(401, 'Sesi berakhir. Masuk lagi untuk melanjutkan.');
    expect(await outbox.flush(expired.send)).toEqual({ sent: 0, left: 2 });
    // One request, not one per report: the session is gone for all of them.
    expect(expired.sent).toEqual(['a']);
    const [first] = await outbox.queued();
    expect(first).toMatchObject({ rejected: false, attempts: 1, lastError: 'Sesi berakhir. Masuk lagi untuk melanjutkan.' });
    expect(outbox.outboxSignedOut()).toBe(true);
    expect(ended).toHaveBeenCalledTimes(1);
    // Nothing goes out meanwhile, also when the session check says nobody is signed in.
    const api = server();
    await outbox.flush(api.send);
    outbox.setOutboxAccount(null);
    await outbox.flush(api.send);
    expect(api.sent).toEqual([]);
    outbox.setOutboxAccount('mpa-1');
    expect(outbox.outboxSignedOut()).toBe(false);
    expect(await outbox.flush(api.send)).toEqual({ sent: 2, left: 0 });
  });

  it('holds while a sign-in or sign-out is under way, and asks for the account again before every report', async () => {
    outbox.setOutboxAccount('mpa-1');
    await outbox.enqueue(report('a'));
    const release = outbox.holdOutbox();
    const api = server();
    await outbox.flush(api.send);
    expect(api.sent).toEqual([]);
    release();
    release();
    await outbox.flush(api.send);
    expect(api.sent).toEqual(['a']);
    // "Lihat sebagai: Kades" goes through while the first of two reports is uploading.
    await outbox.enqueue(report('b'));
    await outbox.enqueue(report('c'));
    const sent: string[] = [];
    await outbox.flush(async item => {
      sent.push(item.clientUuid);
      const switching = outbox.holdOutbox();
      outbox.setOutboxAccount('kades-1');
      switching();
      return new Response('{}', { status: 201 });
    });
    expect(sent).toEqual(['b']);
    expect((await outbox.queued()).map(item => item.clientUuid)).toEqual(['c']);
  });

  it('tries again as soon as an account may send, without waiting for the next round', async () => {
    const window = Object.assign(new EventTarget(), { setInterval: () => 0, clearInterval: () => {} });
    vi.stubGlobal('window', window);
    const posted: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { posted.push(url); return new Response('{}', { status: 201 }); }));
    await outbox.enqueue(report('a', 'mpa-1'));
    const stop = outbox.startOutboxSync();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(posted).toEqual([]);
    outbox.setOutboxAccount('mpa-1');
    await vi.waitFor(async () => expect(await outbox.queued()).toEqual([]));
    expect(posted).toEqual(['/api/v1/incidents/i/verifications']);
    stop();
  });
});

describe('what each account sees of the outbox', () => {
  const item = (clientUuid: string, userId: string | undefined, extra: Partial<QueuedReport> = {}): QueuedReport => ({
    ...report(clientUuid, userId), queuedAt: '2026-11-04T01:42:00Z', attempts: 0, lastError: null, rejected: false, ...extra,
  });
  const items = [
    item('mine', 'mpa-1'),
    item('old', undefined),
    item('theirs', 'mpa-2'),
    item('theirs-refused', 'mpa-2', { rejected: true, lastError: 'Catatan pribadi mpa-2 ditolak.' }),
    item('mine-refused', 'mpa-1', { rejected: true, lastError: 'Status tidak valid.' }),
  ];
  const lines = (viewer: string | null, options: { online?: boolean; signedOut?: boolean; lang?: string } = {}) => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'titikapi.lang' ? options.lang ?? null : null), setItem() {}, removeItem() {} });
    return renderToStaticMarkup(createElement(LangProvider, null,
      createElement(OutboxLines, { items, viewer, online: options.online ?? true, signedOut: options.signedOut ?? false })));
  };

  it('counts its own reports (and those saved before accounts were recorded), and another account\'s as a number only', async () => {
    const { outboxView } = outbox;
    const view = outboxView(items, 'mpa-1');
    expect(view.waiting.map(entry => entry.clientUuid)).toEqual(['mine', 'old']);
    expect(view.rejected.map(entry => entry.clientUuid)).toEqual(['mine-refused']);
    expect(view.others).toBe(1);
    // A visitor files nothing: every waiting report waits for an account, the older ones too.
    expect(outboxView(items, null)).toMatchObject({ waiting: [], rejected: [], others: 3 });
  });

  it('says in both languages that another account\'s report waits for that account, and shows nothing else of it', () => {
    const html = lines('mpa-1');
    expect(html).toContain('2 laporan menunggu sinyal sejak 08.42.');
    expect(html).toContain('1 laporan ditolak: Status tidak valid.');
    expect(html).toContain('1 laporan menunggu akun pengirimnya masuk lagi.');
    expect(html).toContain('Kirim sekarang');
    expect(html).not.toContain('Catatan pribadi');
    const visitor = lines(null);
    expect(visitor).toContain('3 laporan menunggu akun pengirimnya masuk lagi.');
    expect(visitor).not.toContain('Kirim sekarang');
    expect(lines(null, { lang: 'en' })).toContain('3 reports waiting for the accounts that filed them to sign in again.');
    expect(lines('mpa-2', { lang: 'en' })).toContain('1 report waiting for the account that filed it to sign in again.');
  });

  it('asks the volunteer to sign in again after a 401, without a send button that could not send', () => {
    const html = lines('mpa-1', { signedOut: true });
    expect(html).toContain('2 laporan menunggu kamu masuk lagi.');
    expect(html).not.toContain('Kirim sekarang');
    expect(lines('mpa-1', { signedOut: true, lang: 'en' })).toContain('2 reports waiting for you to sign in again.');
  });

  it('shows nothing while online when nothing of the account waits and no other account\'s report does', () => {
    expect(renderToStaticMarkup(createElement(OutboxLines, { items: [items[3]!], viewer: 'mpa-1', online: true, signedOut: false }))).toBe('');
    expect(renderToStaticMarkup(createElement(OutboxLines, { items: [], viewer: null, online: false, signedOut: false }))).toContain('Tanpa sinyal.');
  });
});
