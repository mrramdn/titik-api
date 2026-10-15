import { Link } from 'react-router';
import type { Alert } from '../api';
import { api } from '../api';
import { ago, wib } from '../format';
import { Facts, LevelBadge, StatusPill, shareCard } from './ui';

/** An alert card in the shape of a field dispatch ticket. */
export function Ticket({ alert, onChange, canVerify }: { alert: Alert; onChange?: () => void; canVerify: boolean }) {
  const { incident } = alert;
  const share = async () => {
    const done = await shareCard(alert.card, incident.sharePath);
    if (done) await api(`/me/alerts/${alert.id}/shared`, { method: 'POST' }).catch(() => {});
    onChange?.();
  };
  return (
    <article className={`ticket ticket-${incident.level} ${alert.readAt ? '' : 'ticket-unread'}`}>
      <div className="ticket-band"><span>{incident.level}</span></div>
      <div className="ticket-body">
        <header className="ticket-head mono">
          <span>KJD-{incident.code.toUpperCase()}</span>
          <span>{wib(incident.lastDetectedAt)} WIB · {ago(incident.lastDetectedAt)}</span>
        </header>
        <Link to={`/kejadian/${incident.id}`} className="ticket-main">
          <h3>{incident.detectionCount} titik panas <span className="ticket-village">· Desa {alert.village.name}</span></h3>
          <p className="ticket-card">{alert.card}</p>
        </Link>
        <Facts incident={incident} />
        <div className="ticket-perf" aria-hidden="true" />
        <footer className="ticket-actions">
          <div className="ticket-state"><LevelBadge level={incident.level} /><StatusPill status={incident.latestStatus} />{alert.sharedAt && <span className="pill pill-shared">Dibagikan</span>}</div>
          <div className="ticket-buttons">
            <button type="button" className="btn btn-wa" onClick={share}>Bagikan ke WA</button>
            {canVerify && <Link className="btn btn-primary" to={`/kejadian/${incident.id}/cek`}>Cek lapangan</Link>}
          </div>
        </footer>
      </div>
    </article>
  );
}
