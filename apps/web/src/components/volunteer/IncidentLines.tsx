// The lines every volunteer card shares: where the incident is, the facts that set its priority, and where it stands.
import { Download } from 'lucide-react';
import type { Incident } from '../../api';
import { useFormat } from '../../format';
import { bearing, distanceMeters } from '../../geo';
import { dict, useT } from '../../i18n';
import { StatusLine } from '../ui';
import type { MyCheck } from './myChecks';

const text = dict({
  id: {
    gps: '{km} · {dir}', centre: '{km} {dir} pusat Desa {village}', nearCentre: 'dekat pusat Desa {village}',
    priority: 'Prioritas {level}', hotspots: '{n} titik panas', hotspot: '1 titik panas', peat: 'lahan gambut',
    last: 'terakhir {time} WIB', uncertain: 'lokasi ±{km}',
    ready: 'Siap tanpa sinyal', mine: 'Sudah kamu cek {time}', mineNoTime: 'Sudah kamu cek', waiting: 'menunggu sinyal', shared: 'Dibagikan {time}',
  },
  en: {
    gps: '{km} · {dir}', centre: '{km} {dir} of the centre of {village}', nearCentre: 'near the centre of {village}',
    priority: '{level} priority', hotspots: '{n} hotspots', hotspot: '1 hotspot', peat: 'peatland',
    last: 'last seen {time} WIB', uncertain: 'location ±{km}',
    ready: 'Ready without signal', mine: 'You checked it {time}', mineNoTime: 'You checked it', waiting: 'waiting for signal', shared: 'Shared {time}',
  },
});

/** Time today, or day and time for an older moment ("01.41", "15 Okt 01.41"). */
export function useWhen() {
  const f = useFormat();
  return (iso: string) => (f.day(iso) === f.day(new Date()) ? f.time(iso) : f.dayTime(iso));
}

/**
 * Where the incident is, best reference first: distance and direction from the volunteer's GPS fix, then the
 * nearest named settlement, then the centre of its village (what the server's card text said).
 */
export function usePlace() {
  const t = useT(text), f = useFormat();
  const landmark = (incident: Incident) => {
    if (incident.nearestPlace) return f.place(incident.nearestPlace);
    const village = incident.village;
    if (village?.center) {
      const meters = distanceMeters(village.center, incident.centroid);
      return meters < 300 ? t('nearCentre', { village: village.name }) : t('centre', { km: f.km(meters), dir: f.wind(bearing(village.center, incident.centroid)), village: village.name });
    }
    return incident.card?.split(' · ')[1] ?? null;
  };
  return (incident: Incident, here: [number, number] | null): { main: string; sub: string | null } => {
    // With a fix the distance leads and the landmark stays underneath, so the volunteer still knows the area.
    if (here) return { main: t('gps', { km: f.km(distanceMeters(here, incident.centroid)), dir: f.wind(bearing(here, incident.centroid)) }), sub: landmark(incident) };
    return { main: landmark(incident) ?? incident.code.toUpperCase(), sub: null };
  };
}

export function PlaceLines({ incident, here }: { incident: Incident; here: [number, number] | null }) {
  const place = usePlace()(incident, here);
  return <><span className="v-place">{place.main}</span>{place.sub && <span className="v-sub">{place.sub}</span>}</>;
}

/** "Prioritas tinggi · 53 titik panas · lahan gambut · terakhir 01.41 WIB · lokasi ±1 km". */
export function FactsLine({ incident, priority = true }: { incident: Incident; priority?: boolean }) {
  const t = useT(text), f = useFormat(), when = useWhen();
  const facts = [
    priority ? t('priority', { level: f.lang === 'id' ? f.level(incident.level).toLowerCase() : f.level(incident.level) }) : null,
    incident.detectionCount === 1 ? t('hotspot') : t('hotspots', { n: f.num(incident.detectionCount) }),
    incident.onPeat ? t('peat') : null,
    t('last', { time: when(incident.lastDetectedAt) }),
    incident.modisOnly ? t('uncertain', { km: f.km(incident.locationUncertaintyM ?? 1000) }) : null,
  ].filter(Boolean);
  return <span className="v-facts">{facts.join(' · ')}</span>;
}

/** Field status of the card: the volunteer's own check first, then the shared status line; plus offline readiness. */
export function CheckLine({ incident, mine, waiting, ready, sharedAt }: { incident: Incident; mine?: MyCheck; waiting?: boolean; ready?: boolean; sharedAt?: string | null }) {
  const t = useT(text), f = useFormat(), when = useWhen();
  return (
    <span className="v-checkline">
      {mine || waiting
        ? <span className="statusline statusline-checked">{mine ? t('mine', { time: when(mine.at) }) : t('mineNoTime')}{mine ? ` · ${f.status(mine.status)}` : ''}{waiting ? ` · ${t('waiting')}` : ''}</span>
        : <StatusLine incident={incident} />}
      {ready && !mine && !waiting && <span className="v-ready"><Download size={13} aria-hidden="true" />{t('ready')}</span>}
      {sharedAt && <span className="v-muted">{t('shared', { time: when(sharedAt) })}</span>}
    </span>
  );
}
