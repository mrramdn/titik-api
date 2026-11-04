import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronLeft, CircleCheck, MapPin, Share2 } from 'lucide-react';
import type { IncidentDetail, ScorePart, TimelineEvent, Verification } from '../api';
import { LevelBadge, RouteButton, ScoreRows, StatusLine, shareText, useApi, useDataVersion, waText } from '../components/ui';
import { useWind, WindFacts } from '../components/incident/Wind';
import { smokeSentence } from '../components/incident/wind';
import { areaText, indicatedArea } from '../components/incident/area';
import { dict, fill, useLang, useT, type Lang, type Vars } from '../i18n';
import { satelliteName, sensorOf } from '../i18n/common';
import { formatter, useFormat, type Format } from '../format';
import { panelActions } from '../map/archive';
import { MAP_PATH } from '../routes';
import { useSession } from '../session';
import { useScreen } from './MapScreen';

const text = dict({
  id: {
    back: 'Semua kejadian', loading: 'Memuat kejadian…', village: 'Desa {name}', district: 'Kec. {name}', outside: 'Di luar batas desa',
    hotspots: 'Titik panas', split: 'VIIRS {viirs} · MODIS {modis}', frp: 'FRP maks', peat: 'Lahan gambut', yes: 'Ya', no: 'Tidak',
    settlement: 'Permukiman terdekat', unknown: 'Tidak diketahui', modisOnly: 'Hanya terlihat oleh MODIS. Lokasinya bisa bergeser ±{km}.',
    check: 'Cek lapangan', share: 'Bagikan ke WhatsApp', villagePage: 'Halaman desa', history: 'Riwayat', detections: 'Titik panas ({n})',
    detected: 'Terdeteksi {satellite}, {n} titik panas', detectedNoCount: 'Terdeteksi {satellite}', assigned: 'Ditugaskan ke {who}', assignedNoWho: 'Ditugaskan ke regu MPA',
    enroute: '{who} menuju lokasi', enrouteNoWho: 'Regu MPA menuju lokasi', checked: 'Dicek di lapangan.', checkedBy: 'Dicek oleh {who}.', placeDir: '{dir} {name}',
    cancelled: 'Tugas dibatalkan', demo: 'akun demo', distance: '{km} dari titik panas', distanceDemo: 'sekitar {km} dari titik panas', photo: 'Foto cek lapangan',
    privateNote: 'Catatan, foto, dan nama pelapor terlihat setelah masuk.',
    demoPrivateNote: 'Catatan, foto, dan nama pelapor dari akun nyata tidak tampil untuk akun demo.', colTime: 'WIB', colSatellite: 'Satelit', colSensor: 'Sensor',
    colConfidence: 'Keyakinan', colFrp: 'FRP (MW)', moreRows: '{n} titik panas lainnya tidak ditampilkan.', last: 'Titik panas terakhir {ago}.',
    lastAt: 'Titik panas terakhir {time} WIB.', notReplayed: 'Status lapangan dan tugas tampil seperti sekarang, tidak diputar ulang.',
    scoreConfidence: 'Keyakinan satelit {level}', scoreFrp: 'FRP maks {mw} MW', scoreCount: '{n} titik panas', scorePeat: 'Di lahan gambut',
    scoreNoPeat: 'Di luar peta gambut', scoreSettlement: 'Permukiman terdekat {km}', scoreNoSettlement: 'Jarak ke permukiman tidak diketahui', scoreStatic: 'Dekat sumber panas tetap',
  },
  en: {
    back: 'All incidents', loading: 'Loading incident…', village: '{name}', district: '{name} district', outside: 'Outside village boundaries',
    hotspots: 'Hotspots', split: 'VIIRS {viirs} · MODIS {modis}', frp: 'Max FRP', peat: 'Peatland', yes: 'Yes', no: 'No',
    settlement: 'Nearest settlement', unknown: 'Unknown', modisOnly: 'Seen by MODIS only. The location may be off by ±{km}.',
    check: 'Field check', share: 'Share to WhatsApp', villagePage: 'Village page', history: 'History', detections: 'Hotspots ({n})',
    detected: 'Detected by {satellite}, {n} hotspots', detectedNoCount: 'Detected by {satellite}', assigned: 'Assigned to {who}', assignedNoWho: 'Assigned to an MPA team',
    enroute: '{who} on the way', enrouteNoWho: 'MPA team on the way', checked: 'Checked in the field.', checkedBy: 'Checked by {who}.', placeDir: '{dir} of {name}',
    cancelled: 'Task cancelled', demo: 'demo account', distance: '{km} from the hotspot', distanceDemo: 'about {km} from the hotspot', photo: 'Field check photo',
    privateNote: 'Notes, photos and reporter names are visible after signing in.',
    demoPrivateNote: 'Notes, photos and reporter names from real accounts are not shown to demo accounts.', colTime: 'WIB', colSatellite: 'Satellite', colSensor: 'Sensor',
    colConfidence: 'Confidence', colFrp: 'FRP (MW)', moreRows: '{n} more hotspots not shown.', last: 'Last hotspot {ago}.',
    lastAt: 'Last hotspot {time} WIB.', notReplayed: 'Field status and tasks show as they are now; they are not replayed.',
    scoreConfidence: 'Satellite confidence {level}', scoreFrp: 'Max FRP {mw} MW', scoreCount: '{n} hotspots', scorePeat: 'On peatland',
    scoreNoPeat: 'Outside the peat map', scoreSettlement: 'Nearest settlement {km}', scoreNoSettlement: 'Distance to settlement unknown', scoreStatic: 'Near a fixed heat source',
  },
});
type T = (key: keyof typeof text.id, vars?: Vars) => string;

/** Detection passes and field checks for an API that sends no timeline yet. */
function fallbackTimeline(d: IncidentDetail): TimelineEvent[] {
  const passes = new Map<string, TimelineEvent>();
  for (const x of d.detections ?? []) {
    const key = `${x.satellite}|${x.acqAt}`;
    const event = passes.get(key) ?? { kind: 'detected', at: x.acqAt, satellite: x.satellite, count: 0 };
    event.count = (event.count ?? 0) + 1;
    passes.set(key, event);
  }
  const checks: TimelineEvent[] = (d.verifications ?? []).map(v => ({ kind: 'checked', at: v.observedAt, status: v.status, actor: v.reporter, demo: v.demo }));
  return [...passes.values(), ...checks];
}

function eventText(event: TimelineEvent, t: T, f: Format) {
  const who = event.actor;
  switch (event.kind) {
    case 'detected': {
      const satellite = event.satellite ? satelliteName(event.satellite) : 'NASA FIRMS';
      return event.count ? t('detected', { satellite, n: f.num(event.count) }) : t('detectedNoCount', { satellite });
    }
    case 'assigned': return who ? t('assigned', { who }) : t('assignedNoWho');
    case 'enroute': return who ? t('enroute', { who }) : t('enrouteNoWho');
    case 'checked': { const head = who ? t('checkedBy', { who }) : t('checked'); return event.status ? `${head} ${f.status(event.status)}.` : head; }
    case 'cancelled': return t('cancelled');
    default: return String((event as { kind: string }).kind);
  }
}

/** Score lines in the visitor's language for the parts the app knows; others keep the server's text. */
function scoreLabels(d: IncidentDetail, t: T, f: Format): ScorePart[] {
  return (d.scoreParts ?? []).map(part => {
    const label = (() => {
      switch (part.key) {
        case 'keyakinan': return d.bestConfidence ? t('scoreConfidence', { level: f.confidence(d.bestConfidence) }) : null;
        case 'frp': return d.maxFrp !== null && d.maxFrp !== undefined ? t('scoreFrp', { mw: f.num(d.maxFrp, 1) }) : null;
        case 'jumlah': return t('scoreCount', { n: f.num(d.detectionCount) });
        case 'gambut': return t(d.onPeat ? 'scorePeat' : 'scoreNoPeat');
        case 'permukiman': return d.settlementMeters === null || d.settlementMeters === undefined ? t('scoreNoSettlement') : t('scoreSettlement', { km: f.km(d.settlementMeters) });
        case 'sumber_tetap': return t('scoreStatic');
        default: return null;
      }
    })();
    return label ? { ...part, label } : part;
  });
}

/**
 * The distance the score uses (any settlement), with the nearest named place under it; the named place can be
 * further away than an unnamed settlement, so its own distance is shown when it differs.
 */
function settlementFact(d: IncidentDetail, t: T, f: Format) {
  const place = d.nearestPlace;
  const meters = d.settlementMeters ?? place?.distanceM ?? null;
  if (meters === null) return <b>{t('unknown')}</b>;
  const sameSpot = place && Math.abs(place.distanceM - meters) < 50;
  return <><b>{f.km(meters)}</b>{place && <small>{sameSpot ? t('placeDir', { dir: f.wind(place.bearingDeg), name: place.name }) : f.place(place)}</small>}</>;
}

/**
 * "1,2 km dari titik panas" for a field check. A demo check's distance is approximate ("sekitar 100 km"): the server
 * keeps the incident's centre instead of a demo visitor's position and rounds the distance to one significant figure,
 * never finer than 100 m, so that a few checks cannot place the visitor.
 */
export function checkDistance(check: Pick<Verification, 'distanceMeters' | 'demo'>, lang: Lang) {
  if (check.distanceMeters === null || check.distanceMeters === undefined) return null;
  return fill(text[lang][check.demo ? 'distanceDemo' : 'distance'], { km: formatter(lang).km(check.distanceMeters) });
}

export function IncidentPanel() {
  const t = useT(text), f = useFormat(), a = useT(areaText);
  const { lang } = useLang();
  const params = useParams();
  const key = params.id ?? params.code!;
  const { setSelected, filters } = useScreen();
  const archived = Boolean(filters.tanggal);
  const { user } = useSession();
  const { version } = useDataVersion();
  const [tab, setTab] = useState<'history' | 'detections'>('history');
  const incident = useApi<IncidentDetail>(`/incidents/${key}`, version);
  const d = incident.data;
  const wind = useWind(d?.id ?? null, version);
  useEffect(() => { if (d) setSelected({ id: d.id, centroid: d.centroid, detections: (d.detections ?? []).map(x => [x.longitude, x.latitude]) }); }, [d?.id, d?.detections?.length]);
  // On a phone the page itself scrolls: a row tapped far down the list opens with the map and the header in view.
  useEffect(() => { if (typeof matchMedia === 'function' && matchMedia('(max-width: 900px)').matches) window.scrollTo({ top: 0 }); }, [key]);
  const events = useMemo(() => (d ? (Array.isArray(d.timeline) && d.timeline.length ? d.timeline : fallbackTimeline(d)).slice().sort((a, b) => a.at.localeCompare(b.at)) : []), [d]);
  if (incident.error && !d) return <div className="sidebar-scroll detail"><section><Link to={MAP_PATH} className="back"><ChevronLeft size={14} />{t('back')}</Link><p className="subline">{incident.error}</p></section></div>;
  if (!d) return <div className="empty">{t('loading')}</div>;

  const detections = d.detections ?? [];
  const verifications = d.verifications ?? [];
  const multiDay = events.length > 0 && f.day(events[0]!.at) !== f.day(events[events.length - 1]!.at);
  const stamp = (iso: string) => (multiDay ? f.dayTime(iso) : f.time(iso));
  const detectionDays = new Set(detections.map(x => f.day(x.acqAt))).size > 1;
  const byTime = new Map<string, Verification>(verifications.map(v => [v.observedAt, v]));
  const viirs = d.viirsCount ?? detections.filter(x => sensorOf(x.satellite) === 'VIIRS').length;
  const modis = d.modisCount ?? detections.length - viirs;
  const actions = panelActions(user?.role, archived);
  const area = indicatedArea(d, lang);
  return (
    <div className="sidebar-scroll detail ip">
      <section className="ip-head">
        <Link to={MAP_PATH} className="back"><ChevronLeft size={14} aria-hidden="true" />{t('back')}</Link>
        <div className="ip-code"><LevelBadge level={d.level} /><span>KJD-{d.code.toUpperCase()}</span></div>
        <h1 className="title-24">{d.village ? t('village', { name: d.village.name }) : t('outside')}</h1>
        {d.village && <p className="subline">{[t('district', { name: d.village.district }), d.village.regency, d.village.province].join(', ')}</p>}
        <StatusLine incident={d} />
        {actions.notReplayed && <p className="note">{t('notReplayed')}</p>}
        <p className="ip-when">{f.span(d.firstDetectedAt, d.lastDetectedAt)} · {[...new Set(d.satellites ?? [])].map(satelliteName).join(', ')}</p>
      </section>
      <section>
        <div className="ip-facts">
          <div><span className="label">{t('hotspots')}</span><b>{f.num(d.detectionCount)}</b>{(modis > 0 || d.modisCount !== undefined) && <small>{t('split', { viirs: f.num(viirs), modis: f.num(modis) })}</small>}</div>
          <div><span className="label">{t('frp')}</span><b>{d.maxFrp === null || d.maxFrp === undefined ? '–' : `${f.num(d.maxFrp, 1)} MW`}</b></div>
          <div><span className="label">{t('peat')}</span><b>{d.onPeat ? t('yes') : t('no')}</b></div>
          <div><span className="label">{t('settlement')}</span>{settlementFact(d, t, f)}</div>
          {area && (
            <div className="ip-area">
              <span className="label">{a('label')}</span>
              <b>{f.ha(d.indicatedAreaHa!)}{d.modisOnly && <small> {a('coarse')}</small>}</b>
              <small>{a('help')}</small>
            </div>
          )}
        </div>
        {d.modisOnly && <p className="note">{t('modisOnly', { km: f.km(d.locationUncertaintyM ?? 1000) })}</p>}
      </section>
      {wind && <WindFacts wind={wind} />}
      <section className="ip-actions">
        {actions.check && <Link to={`/kejadian/${d.id}/cek`} className="btn btn-primary btn-block"><CircleCheck size={16} aria-hidden="true" />{t('check')}</Link>}
        <div className="ip-actions-row">
          <RouteButton to={d.centroid} className="btn btn-dark" />
          <button type="button" className="btn btn-dark" onClick={() => void shareText(waText(d, lang, smokeSentence(wind, lang)))}><Share2 size={16} aria-hidden="true" />{t('share')}</button>
        </div>
        {d.village && <Link to={`/desa/${d.village.id}`} className="ip-link"><MapPin size={14} aria-hidden="true" />{t('villagePage')}</Link>}
      </section>
      <section><ScoreRows parts={scoreLabels(d, t, f)} score={d.score} /></section>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>{t('history')}</button>
        <button type="button" role="tab" aria-selected={tab === 'detections'} className={tab === 'detections' ? 'on' : ''} onClick={() => setTab('detections')}>{t('detections', { n: f.num(detections.length) })}</button>
      </div>
      {tab === 'history' ? (
        <ol className="ip-timeline">
          {events.map((event, index) => {
            const check = event.kind === 'checked' ? byTime.get(event.at) : undefined;
            return (
              <li key={`${event.kind}-${event.at}-${index}`} className={`ip-event ip-event-${event.kind}`}>
                <time dateTime={event.at}>{stamp(event.at)}</time>
                <div>
                  <span>{eventText(event, t, f)}{event.demo ? ` (${t('demo')})` : ''}</span>
                  {check?.distanceMeters !== null && check?.distanceMeters !== undefined && <small>{checkDistance(check, lang)}</small>}
                  {check?.note && <small>{check.note}</small>}
                  {check?.photoThumbUrl && <img src={check.photoThumbUrl} alt={t('photo')} loading="lazy" />}
                </div>
              </li>
            );
          })}
          {!user && verifications.length > 0 && <li className="note">{t('privateNote')}</li>}
          {user?.demo && verifications.some(v => !v.demo) && <li className="note">{t('demoPrivateNote')}</li>}
        </ol>
      ) : (
        <>
          <table className="det-table">
            <thead><tr><th>{t('colTime')}</th><th>{t('colSatellite')}</th><th>{t('colSensor')}</th><th>{t('colConfidence')}</th><th>{t('colFrp')}</th></tr></thead>
            <tbody>{detections.slice(0, 120).map(x => {
              const sensor = x.sensor ?? sensorOf(x.satellite);
              return (
                <tr key={x.id}>
                  <td>{detectionDays ? f.dayTime(x.acqAt) : f.time(x.acqAt)}</td><td>{satelliteName(x.satellite)}</td><td>{sensor}</td>
                  <td>{sensor === 'MODIS' && x.confidencePct !== null && x.confidencePct !== undefined ? `${x.confidencePct}%` : f.confidence(x.confidence)}</td>
                  <td>{x.frp === null || x.frp === undefined ? '–' : f.num(x.frp, 1)}</td>
                </tr>
              );
            })}</tbody>
          </table>
          {detections.length > 120 && <p className="note ip-more">{t('moreRows', { n: f.num(detections.length - 120) })}</p>}
        </>
      )}
      <p className="note ip-last">{archived ? t('lastAt', { time: f.dayTime(d.lastDetectedAt) }) : t('last', { ago: f.ago(d.lastDetectedAt) })}</p>
    </div>
  );
}
