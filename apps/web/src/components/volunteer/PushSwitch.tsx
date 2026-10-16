// Notifications in one line: a switch, a test button once it is on, and a short result after each action.
import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { dict, useT } from '../../i18n';
import { currentSubscription, disablePush, enablePush, pushSupported, PushError, testPush, type PushProblem } from '../../push';
import { useErrorText } from '../ui';

const text = dict({
  id: {
    label: 'Notifikasi', test: 'Uji', unsupported: 'Peramban ini tidak mendukung notifikasi.',
    on: 'Notifikasi aktif di perangkat ini.', off: 'Notifikasi dimatikan.', sent: 'Notifikasi uji terkirim.',
    disabled: 'Notifikasi belum disiapkan di server ini.', denied: 'Izin notifikasi ditolak. Ubah di pengaturan situs.',
  },
  en: {
    label: 'Notifications', test: 'Test', unsupported: 'This browser does not support notifications.',
    on: 'Notifications are on for this device.', off: 'Notifications are off.', sent: 'Test notification sent.',
    disabled: 'Notifications are not set up on this server.', denied: 'Notifications are blocked. Change it in the site settings.',
  },
});

export function PushSwitch() {
  const t = useT(text), describe = useErrorText();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const supported = pushSupported();
  useEffect(() => { if (supported) void currentSubscription().then(s => setOn(Boolean(s))).catch(() => setOn(false)); }, [supported]);

  const run = async (work: () => Promise<unknown>, done: Parameters<typeof t>[0]) => {
    setBusy(true); setMessage(null);
    try { await work(); setMessage(t(done)); }
    catch (error) { setMessage(error instanceof PushError ? t(error.problem satisfies PushProblem) : describe(error)); }
    finally { setBusy(false); }
  };
  const toggle = () => (on
    ? run(async () => { await disablePush(); setOn(false); }, 'off')
    : run(async () => { await enablePush(); setOn(true); }, 'on'));

  if (!supported) return <div className="v-push"><BellOff size={16} aria-hidden="true" /><span className="v-muted">{t('unsupported')}</span></div>;
  return (
    <div className="v-push-wrap">
      <div className="v-push">
        {on ? <Bell size={16} aria-hidden="true" /> : <BellOff size={16} aria-hidden="true" />}
        <label className="v-switch">
          <span>{t('label')}</span>
          <input type="checkbox" role="switch" checked={Boolean(on)} aria-checked={Boolean(on)} disabled={busy || on === null} onChange={() => void toggle()} />
          <i aria-hidden="true" />
        </label>
        {on && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run(testPush, 'sent')}>{t('test')}</button>}
      </div>
      {message && <span className="v-push-msg" role="status">{message}</span>}
    </div>
  );
}
