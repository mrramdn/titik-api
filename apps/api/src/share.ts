import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { cardIncident, incidentSelect } from './incidents.js';
import { cardText } from './geo.js';

const escape = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

// The link in a WhatsApp message opens the incident for anyone; the preview shows the card itself.
export function installShare(app: FastifyInstance, pool: pg.Pool, webDir: string) {
  app.get('/k/:code', async (request, reply) => {
    const code = String((request.params as { code: string }).code);
    const index = `${webDir}/index.html`;
    if (!existsSync(index)) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Halaman tidak ditemukan.' } });
    let html = await readFile(index, 'utf8');
    if (/^[0-9a-z]{4,12}$/.test(code)) {
      const row = (await pool.query(`${incidentSelect} WHERE i.code = $1`, [code])).rows[0];
      if (row?.village_name) {
        const title = `${row.detection_count} titik panas · Desa ${row.village_name} · prioritas ${String(row.level).toUpperCase()}`;
        const description = cardText(cardIncident(row), { name: row.village_name, center: [row.village_lon, row.village_lat] });
        html = html.replace(/<title>[^<]*<\/title>/, `<title>${escape(title)} · Titik Api</title>`)
          .replace(/<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${escape(title)}" />`)
          .replace(/<meta (name|property)="(og:)?description" content="[^"]*"\s*\/?>/g, (_m, attr, og) => `<meta ${attr}="${og ?? ''}description" content="${escape(description)}" />`);
      }
    }
    reply.header('Cache-Control', 'no-cache').type('text/html');
    return html;
  });
}
