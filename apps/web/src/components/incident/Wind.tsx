// Wind in the incident panel: GET /incidents/:id/wind once when the panel opens (never per list row), then where the
// wind comes from, where the smoke drifts and which villages lie that way.
import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { api, type Wind } from '../../api';
import { useLang, useT } from '../../i18n';
import { downwindLine, windLine, windText } from './wind';

/**
 * The wind at one incident, or null: while it loads, when the weather service did not answer ({ data: null }), on an
 * error, or for an older server. A wind from the previous incident never shows on the next one.
 */
export function useWind(id: string | null, version = 0): Wind | null {
  const [state, setState] = useState<{ id: string; wind: Wind | null } | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    api<{ data: Wind | null }>(`/incidents/${id}/wind`).then(
      body => { if (alive) setState({ id, wind: body?.data ?? null }); },
      () => { if (alive) setState({ id, wind: null }); },
    );
    return () => { alive = false; };
  }, [id, version]);
  return state?.id === id ? state.wind : null;
}

/** The arrow points where the smoke drifts. */
export function WindFacts({ wind }: { wind: Wind }) {
  const t = useT(windText);
  const { lang } = useLang();
  const villages = downwindLine(wind, lang);
  return (
    <section className="ip-wind">
      <span className="label">{t('title')}</span>
      <p className="ip-wind-line">
        {!wind.calm && <ArrowUp size={16} className="ip-wind-arrow" style={{ transform: `rotate(${Math.round(wind.towardDeg)}deg)` }} aria-hidden="true" />}
        <span>{windLine(wind, lang)}</span>
      </p>
      {villages && <p className="ip-wind-villages">{villages}</p>}
    </section>
  );
}
