import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { cardIncident, incidentSelect } from './incidents.js';
import { cardText, formatCount, formatWibDate } from './geo.js';

const escape = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/**
 * First in the description of a shared incident: its preview is often all a recipient sees, and it must not pass for
 * an official alert. The same words as the demo line under the map.
 */
export const DEMO_NOTE = 'Demo portofolio dengan data satelit asli, bukan sistem peringatan resmi.';

// The link in a WhatsApp message opens the incident for anyone; the preview shows the alert text after the demo note.
// Previews are read days later, so title and description carry the date of the detections (an incident is one WIB
// day). A shared link is meant for the people it was sent to: search engines are asked to leave every /k/ page out.
export function installShare(app: FastifyInstance, pool: pg.Pool, webDir: string) {
  app.get('/k/:code', async (request, reply) => {
    const code = String((request.params as { code: string }).code);
    const index = `${webDir}/index.html`;
    if (!existsSync(index)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Halaman tidak ditemukan. Buka peta Titik Api.' } });
    let html = await readFile(index, 'utf8');
    if (/^[0-9a-z]{4,12}$/.test(code)) {
      // A link preview is public: the real scope.
      const row = (await pool.query(`${incidentSelect('real')} WHERE i.code = $1`, [code])).rows[0];
      if (row?.village_name) {
        const title = `${formatCount(row.detection_count)} titik panas · Desa ${row.village_name} · ${formatWibDate(row.last_detected_at)} · prioritas ${row.level}`;
        // Up front, where a preview that cuts the description short still shows it.
        const description = `${DEMO_NOTE} ${cardText(cardIncident(row), new Date(), true)}`;
        html = html.replace(/<title>[^<]*<\/title>/, `<title>${escape(title)} · Titik Api</title>`)
          .replace(/<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${escape(title)}" />`)
          .replace(/<meta (name|property)="(og:)?description" content="[^"]*"\s*\/?>/g, (_m, attr, og) => `<meta ${attr}="${og ?? ''}description" content="${escape(description)}" />`);
      }
    }
    html = html.replace('</head>', '<meta name="robots" content="noindex" />\n  </head>');
    reply.header('Cache-Control', 'no-cache').header('X-Robots-Tag', 'noindex').type('text/html');
    return html;
  });
}
