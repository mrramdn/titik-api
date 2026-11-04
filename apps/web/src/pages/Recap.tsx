// Rekap harian: one WIB day for the province chosen in the top bar, ready to share on WhatsApp or print on A4.
import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronLeft, Printer, Share2 } from 'lucide-react';
import type { Recap, RegencyRiskDay, Risk } from '../api';
import { Shell } from '../components/Shell';
import { Banner, shareText, useDataVersion } from '../components/ui';
import { dict, useLang, useT } from '../i18n';
import { useFormat } from '../format';
import { assignmentLabel } from '../i18n/common';
import { useRegion } from '../region';
import { useSession } from '../session';
import { canUseBpbd, RoleGate } from '../components/bpbd/RoleGate';
import { isDate, shiftDate, todayWib, useLoad } from '../components/bpbd/data';
import { assignmentOrder, checkedShare, longDate, recapText, statusOrder } from '../components/bpbd/recapText';
import { fwiLabel, highDanger, partialText, regencyDays, riskPath } from '../map/risk';
import { RiskSwatch } from '../map/RiskParts';
import { FireDangerCredit } from '../components/OpenMeteo';

const text = dict({
  id: {
    back: 'Dasbor', title: 'Rekap harian', both: 'Sumatera Selatan dan Kalimantan Tengah',
    dates: 'Tanggal rekap', today: 'Hari ini', yesterday: 'Kemarin', pick: 'Pilih tanggal',
    share: 'Bagikan ke WhatsApp', print: 'Cetak / PDF', loading: 'Memuat rekap…',
    totals: 'Ringkasan', incidents: 'Kejadian', high: 'Prioritas tinggi', checked: 'Sudah dicek', share_: '{p} dari kejadian',
    response: 'Waktu tanggap', responseNote: 'Median deteksi ke cek', falseAlarms: 'Alarm palsu', detections: 'Titik panas',
    regencies: 'Per kabupaten', regency: 'Kabupaten', openHigh: 'Tinggi belum dicek',
    villages: 'Desa dengan kejadian terbanyak', village: 'Desa', where: 'Kec. {district}, {regency}',
    checks: 'Hasil cek lapangan', checksTotal: '{n} laporan pada tanggal ini', noChecks: 'Belum ada cek lapangan pada tanggal ini.',
    assignments: 'Penugasan', assignmentsTotal: '{n} tugas', noAssignments: 'Belum ada penugasan pada tanggal ini.',
    missingTitle: 'Rekap belum tersedia', missing: 'Server belum menyediakan rekap harian. Angka 24 jam terakhir ada di dasbor.',
    emptyTitle: 'Tidak ada kejadian', empty: 'Tidak ada kejadian pada {date} di {place}. Pilih tanggal lain.', dashboard: 'Buka dasbor',
    note: 'Waktu tanggap adalah median dari deteksi satelit sampai cek lapangan pertama. Tanggal mengikuti WIB.',
    printed: 'Dicetak dari Titik Api, {time} WIB.',
    danger: 'Bahaya kebakaran',
    dangerNote: 'Bahaya kebakaran: FWI dari data model Open-Meteo dengan kelas BMKG. Tiap kabupaten diberi kelas yang mencakup bagian terluas wilayahnya. Baris kecil menyebut kelas tertinggi yang, bersama kelas di atasnya, mencakup sedikitnya 10% wilayah, beserta bagian wilayah itu. Bukan produk resmi BMKG.',
  },
  en: {
    back: 'Dashboard', title: 'Daily recap', both: 'Sumatera Selatan and Kalimantan Tengah',
    dates: 'Recap date', today: 'Today', yesterday: 'Yesterday', pick: 'Choose a date',
    share: 'Share on WhatsApp', print: 'Print / PDF', loading: 'Loading the recap…',
    totals: 'Summary', incidents: 'Incidents', high: 'High priority', checked: 'Checked', share_: '{p} of incidents',
    response: 'Response time', responseNote: 'Median detection to check', falseAlarms: 'False alarms', detections: 'Hotspots',
    regencies: 'By regency', regency: 'Regency', openHigh: 'High, not checked',
    villages: 'Villages with the most incidents', village: 'Village', where: '{district}, {regency}',
    checks: 'Field check results', checksTotal: '{n} reports on this date', noChecks: 'No field checks on this date yet.',
    assignments: 'Assignments', assignmentsTotal: '{n} tasks', noAssignments: 'No assignments on this date yet.',
    missingTitle: 'Recap not available', missing: 'The server does not provide the daily recap yet. The dashboard shows the last 24 hours.',
    emptyTitle: 'No incidents', empty: 'No incidents on {date} in {place}. Choose another date.', dashboard: 'Open the dashboard',
    note: 'Response time is the median from the satellite detection to the first field check. Dates follow WIB.',
    printed: 'Printed from Titik Api, {time} WIB.',
    danger: 'Fire danger',
    dangerNote: 'Fire danger: FWI from Open-Meteo model data with BMKG classes. Each regency gets the class that covers the largest part of its area. The small line names the highest class that, together with the classes above it, covers at least 10% of the area, with that part of the area. Not an official BMKG product.',
  },
});

const hasAny = (counts?: Partial<Record<string, number>> | null) => Object.values(counts ?? {}).some(value => (value ?? 0) > 0);

export function RecapPage() {
  const { user } = useSession();
  if (!canUseBpbd(user?.role)) return <RoleGate page="recap" />;
  return <RecapView />;
}

function RecapView() {
  const t = useT(text), f = useFormat();
  const { lang } = useLang();
  const { province, query } = useRegion();
  const { version } = useDataVersion();
  const [params, setParams] = useSearchParams();
  const today = todayWib(), yesterday = shiftDate(today, -1);
  const asked = params.get('date');
  const date = isDate(asked) && asked <= today ? asked : today;
  const setDate = (value: string) => setParams(isDate(value) && value < today ? { date: value } : {}, { replace: true });
  const recap = useLoad<Recap>(`/recap?date=${date}${query}`, version);
  // That date's fire danger per regency: today's forecast, or the archive day. Without it (an older server, a date the
  // weather archive does not hold, nothing computed yet) the column stays away. The day is found by its date: a copy
  // of the live answer that the service worker kept from an earlier day starts on that day, not on today.
  const risk = useLoad<Risk>(riskPath(date === today ? '' : date), version);
  const danger = useMemo(() => regencyDays(risk.data, date), [risk.data, date]);
  const place = province || t('both');
  const data = recap.data;
  const totals = data?.totals;
  const missing = recap.status === 404;
  const empty = Boolean(totals && !totals.incidents && !totals.detections && !hasAny(data?.checks) && !hasAny(data?.assignments));
  // Share and print only when there is a recap to pass on.
  const ready = Boolean(data && totals && !missing && !empty);
  const dangerShown = danger.size > 0 && (data?.regencies ?? []).some(row => danger.has(`${row.province}/${row.name}`));
  const share = () => {
    if (!data) return;
    const high = risk.data?.fetchedAt ? highDanger(risk.data, date, province) : [];
    void shareText(recapText({ ...data, date }, lang, place, `${location.origin}/rekap?date=${date}`, high));
  };

  return (
    <Shell>
      <main className="page recap">
        <Link to="/dasbor" className="bd-back no-print"><ChevronLeft size={16} />{t('back')}</Link>
        <div className="bd-head">
          <div>
            <h1 className="title-24">{t('title')}</h1>
            <p>{place} · {longDate(date, lang)}</p>
          </div>
          {ready && (
            <div className="bd-actions no-print">
              <button type="button" className="btn btn-primary btn-sm" onClick={share}><Share2 size={16} />{t('share')}</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.print()}><Printer size={16} />{t('print')}</button>
            </div>
          )}
        </div>
        <div className="recap-dates no-print" role="group" aria-label={t('dates')}>
          <div className="bd-window">
            <button type="button" className={date === today ? 'on' : ''} aria-pressed={date === today} onClick={() => setDate(today)}>{t('today')}</button>
            <button type="button" className={date === yesterday ? 'on' : ''} aria-pressed={date === yesterday} onClick={() => setDate(yesterday)}>{t('yesterday')}</button>
          </div>
          <input type="date" className="recap-date" value={date} max={today} aria-label={t('pick')} onChange={event => setDate(event.target.value)} />
        </div>

        {recap.error && !missing && <Banner tone="warn">{recap.error}</Banner>}
        {!data && recap.loading && <p className="bd-quiet">{t('loading')}</p>}
        {missing && <Empty title={t('missingTitle')} action={t('dashboard')}>{t('missing')}</Empty>}
        {!missing && empty && <Empty title={t('emptyTitle')} action={t('dashboard')}>{t('empty', { date: longDate(date, lang), place })}</Empty>}

        {ready && data && totals && (
          <div className={`recap-body ${recap.loading ? 'loading' : ''}`}>
            <section className="recap-totals" aria-label={t('totals')}>
              <div className="recap-total"><span>{t('incidents')}</span><b>{f.num(totals.incidents)}</b></div>
              <div className="recap-total"><span>{t('high')}</span><b className={totals.high ? 'hot' : ''}>{f.num(totals.high)}</b></div>
              <div className="recap-total"><span>{t('checked')}</span><b>{f.num(totals.checked)}</b><small>{t('share_', { p: f.percent(checkedShare(totals)) })}</small></div>
              <div className="recap-total"><span>{t('response')}</span><b>{f.duration(totals.medianMinutes)}</b><small>{t('responseNote')}</small></div>
              <div className="recap-total"><span>{t('falseAlarms')}</span><b>{f.num(totals.falseAlarms)}</b></div>
              <div className="recap-total"><span>{t('detections')}</span><b>{f.num(totals.detections)}</b></div>
            </section>

            {(data.regencies ?? []).length > 0 && (
              <section className="bd-section" aria-labelledby="recap-regencies">
                <h2 id="recap-regencies" className="heading-16">{t('regencies')}</h2>
                <div className="bd-table-wrap">
                  <table className="bd-table recap-regencies">
                    <thead>
                      <tr><th>{t('regency')}</th><th className="num">{t('incidents')}</th><th className="num">{t('high')}</th><th className="num">{t('checked')}</th>
                        <th className="num">{t('openHigh')}</th><th className="num">{t('response')}</th>{dangerShown && <th>{t('danger')}</th>}</tr>
                    </thead>
                    <tbody>
                      {data.regencies.map(row => (
                        <tr key={`${row.province}/${row.name}`}>
                          <td className="name">{row.name}{!province && row.province && <small>{row.province}</small>}</td>
                          <td className="num">{f.num(row.incidents)}</td>
                          <td className="num">{f.num(row.high)}</td>
                          <td className="num">{f.num(row.checked)}</td>
                          <td className={`num ${row.openHigh ? 'hot' : ''}`}>{row.openHigh ? f.num(row.openHigh) : '–'}</td>
                          <td className="num">{f.duration(row.medianMinutes)}</td>
                          {dangerShown && <td><DangerTag day={danger.get(`${row.province}/${row.name}`)} /></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {(data.villages ?? []).length > 0 && (
              <section className="bd-section" aria-labelledby="recap-villages">
                <h2 id="recap-villages" className="heading-16">{t('villages')}</h2>
                <div className="bd-table-wrap">
                  <table className="bd-table recap-villages">
                    <thead>
                      <tr><th>{t('village')}</th><th className="num">{t('incidents')}</th><th className="num">{t('high')}</th><th className="num">{t('checked')}</th><th className="num">{t('detections')}</th></tr>
                    </thead>
                    <tbody>
                      {data.villages.slice(0, 10).map(row => (
                        <tr key={row.id}>
                          <td className="name">{row.name}<small>{t('where', { district: row.district, regency: row.regency })}</small></td>
                          <td className="num">{f.num(row.incidents)}</td>
                          <td className="num">{f.num(row.high)}</td>
                          <td className="num">{f.num(row.checked)}</td>
                          <td className="num">{f.num(row.detections)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <div className="recap-two">
              <Breakdown title={t('checks')} total={t('checksTotal', { n: f.num(sum(data.checks)) })} none={t('noChecks')} num={f.num}
                rows={statusOrder.map(status => ({ key: status, label: f.status(status), value: data.checks?.[status] ?? 0 }))} />
              <Breakdown title={t('assignments')} total={t('assignmentsTotal', { n: f.num(sum(data.assignments)) })} none={t('noAssignments')} num={f.num}
                rows={assignmentOrder.map(status => ({ key: status, label: assignmentLabel[lang][status], value: data.assignments?.[status] ?? 0 }))} />
            </div>

            <p className="note">{t('note')}</p>
            {dangerShown && <p className="note">{t('dangerNote')}</p>}
            {/* On the page and on paper; the WhatsApp text names neither source. */}
            {dangerShown && <p className="note"><FireDangerCredit /></p>}
            <p className="note print-only">{t('printed', { time: f.dayTime(new Date()) })}</p>
          </div>
        )}
      </main>
    </Shell>
  );
}

/** A regency's fire danger class on the recap date, as on the map, and a higher class over part of it. */
function DangerTag({ day }: { day: RegencyRiskDay | undefined }) {
  const { lang } = useLang();
  if (!day) return <>–</>;
  return (<>
    <span className="fwi-tag"><RiskSwatch fwiClass={day.fwiClass} />{fwiLabel[lang][day.fwiClass]}</span>
    {day.partial && <small className="fwi-partial">{partialText(day.partial, lang)}</small>}
  </>);
}

const sum = (counts?: Partial<Record<string, number>> | null) => Object.values(counts ?? {}).reduce<number>((total, value) => total + (value ?? 0), 0);

interface BreakdownProps { title: string; total: string; none: string; rows: { key: string; label: string; value: number }[]; num(value: number): string }

function Breakdown({ title, total, none, rows, num }: BreakdownProps) {
  const shown = rows.filter(row => row.value > 0);
  const top = Math.max(1, ...shown.map(row => row.value));
  return (
    <section className="bd-section">
      <div className="bd-section-head"><h2 className="heading-16">{title}</h2>{shown.length > 0 && <span className="caption muted">{total}</span>}</div>
      {shown.length ? (
        <div className="recap-bars">
          {shown.map(row => (
            <div key={row.key} className="recap-bar"><span>{row.label}</span><i><em style={{ width: `${(row.value / top) * 100}%` }} /></i><b>{num(row.value)}</b></div>
          ))}
        </div>
      ) : <p className="recap-none">{none}</p>}
    </section>
  );
}

function Empty({ title, action, children }: { title: string; action: string; children: ReactNode }) {
  return (
    <div className="recap-empty">
      <b>{title}</b>
      <p>{children}</p>
      <Link to="/dasbor" className="btn btn-secondary btn-sm no-print">{action}</Link>
    </div>
  );
}
