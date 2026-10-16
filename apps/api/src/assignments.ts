// Tasks from BPBD/Daops to a regu MPA: ditugaskan → menuju → selesai (closed by any field check of the incident)
// or dibatalkan. One open task per incident; the squad hears about it by push and sees it on its task list.
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { authenticated } from './auth.js';
import { ApiError, choice, object, requireCondition, text, uuid } from './errors.js';
import { cardText } from './geo.js';
import { assignmentModel, cardIncident, clearTileCache, getIncident, incidentModel, incidentSelect } from './incidents.js';
import type { Database } from './models.js';
import { pushToUser, type Sender } from './push.js';

const OPEN = `('ditugaskan', 'menuju')`;
const closedMessage = 'Tugas ini sudah selesai atau dibatalkan. Muat ulang daftar tugas.';

/** Columns of an assignment and its people, named with a prefix for assignmentModel. */
const taskColumns = (prefix: string) => `a.id AS ${prefix}id, a.status AS ${prefix}status, a.note AS ${prefix}note, a.created_at AS ${prefix}created_at,
  a.updated_at AS ${prefix}updated_at, a.closed_at AS ${prefix}closed_at, a.assignee_id AS ${prefix}assignee_id, u.name AS ${prefix}assignee_name,
  u.organization AS ${prefix}assignee_organization, b.name AS ${prefix}assigned_by`;
const taskJoins = 'JOIN users u ON u.id = a.assignee_id JOIN users b ON b.id = a.assigned_by';

export async function loadAssignment(db: Database, id: string) {
  const row = (await db.query(`SELECT ${taskColumns('task_')} FROM assignments a ${taskJoins} WHERE a.id = $1`, [id])).rows[0];
  requireCondition(row, 404, 'NOT_FOUND', 'Tugas tidak ditemukan. Muat ulang daftar tugas.');
  return assignmentModel(row)!;
}

/** A field check closes the incident's open task, whoever filed it; it counts from the time of the check. */
export async function closeOpenAssignment(db: Database, incidentId: string, observedAt: Date) {
  const result = await db.query(`UPDATE assignments SET status = 'selesai', closed_at = greatest($2::timestamptz, created_at), updated_at = now()
    WHERE incident_id = $1 AND status IN ${OPEN} RETURNING id`, [incidentId, observedAt]);
  return (result.rows[0]?.id as string | undefined) ?? null;
}

export function installAssignments(app: FastifyInstance, pool: pg.Pool, send?: Sender) {
  app.post('/api/v1/incidents/:id/assignments', async (request, reply) => {
    const user = authenticated(request, 'bpbd');
    const incident = await getIncident(pool, String(object(request.params).id));
    const body = object(request.body);
    const assigneeId = uuid(body.assigneeId);
    const note = body.note === undefined || body.note === null || body.note === '' ? '' : text(body.note, 'Catatan tugas', 0, 300);
    const assignee = (await pool.query('SELECT id, role FROM users WHERE id = $1', [assigneeId])).rows[0];
    requireCondition(assignee, 404, 'NOT_FOUND', 'Regu tidak ditemukan. Pilih regu dari daftar.');
    requireCondition(assignee.role === 'mpa', 400, 'INVALID_INPUT', 'Tugas hanya untuk akun relawan MPA. Pilih regu MPA.');
    const open = await pool.query(`SELECT 1 FROM assignments WHERE incident_id = $1 AND status IN ${OPEN}`, [incident.id]);
    requireCondition(!open.rowCount, 409, 'ASSIGNMENT_OPEN', 'Kejadian ini sudah punya tugas yang berjalan. Batalkan tugas itu dulu.');
    let id: string;
    try {
      id = (await pool.query('INSERT INTO assignments (incident_id, assignee_id, assigned_by, note) VALUES ($1, $2, $3, $4) RETURNING id',
        [incident.id, assigneeId, user.id, note])).rows[0].id;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ApiError(409, 'ASSIGNMENT_OPEN', 'Kejadian ini sudah punya tugas yang berjalan. Batalkan tugas itu dulu.');
      throw error;
    }
    clearTileCache();
    const place = incident.village_name ? `Desa ${incident.village_name}` : `kejadian ${incident.code}`;
    await pushToUser(pool, assigneeId, { title: `Tugas cek lapangan: ${place}`, body: cardText(cardIncident(incident)), url: '/tugas', tag: `tugas-${id}` }, send)
      .catch(error => request.log.warn({ err: error }, 'Task push failed'));
    reply.code(201);
    return { data: await loadAssignment(pool, id) };
  });

  // The squad sets off (menuju); BPBD/Daops cancels (dibatalkan). A task that is closed stays closed.
  app.patch('/api/v1/assignments/:id', async request => {
    const user = authenticated(request);
    const id = uuid(object(request.params).id);
    const status = choice(object(request.body).status, ['menuju', 'dibatalkan'] as const, 'Status tugas');
    const task = (await pool.query('SELECT assignee_id, status FROM assignments WHERE id = $1', [id])).rows[0];
    requireCondition(task, 404, 'NOT_FOUND', 'Tugas tidak ditemukan. Muat ulang daftar tugas.');
    if (status === 'menuju') requireCondition(task.assignee_id === user.id || user.role === 'admin', 403, 'FORBIDDEN', 'Status ini hanya untuk regu yang ditugaskan.');
    else requireCondition(user.role === 'bpbd' || user.role === 'admin', 403, 'FORBIDDEN', 'Pembatalan tugas hanya untuk BPBD/Daops.');
    requireCondition(task.status === 'ditugaskan' || task.status === 'menuju', 409, 'ASSIGNMENT_CLOSED', closedMessage);
    const updated = await pool.query(status === 'menuju'
      ? `UPDATE assignments SET status = 'menuju', enroute_at = COALESCE(enroute_at, now()), updated_at = now() WHERE id = $1 AND status IN ${OPEN} RETURNING id`
      : `UPDATE assignments SET status = 'dibatalkan', closed_at = now(), updated_at = now() WHERE id = $1 AND status IN ${OPEN} RETURNING id`, [id]);
    requireCondition(updated.rowCount, 409, 'ASSIGNMENT_CLOSED', closedMessage);
    clearTileCache();
    return { data: await loadAssignment(pool, id) };
  });

  // A squad's tasks: the open ones and those closed in the last 7 days, newest first, each with its incident.
  app.get('/api/v1/me/assignments', async request => {
    const user = authenticated(request, 'mpa');
    const rows = (await pool.query(`SELECT ${taskColumns('my_')}, inc.* FROM assignments a ${taskJoins} JOIN (${incidentSelect}) inc ON inc.id = a.incident_id
      WHERE a.assignee_id = $1 AND (a.status IN ${OPEN} OR a.closed_at > now() - interval '7 days')
      ORDER BY a.created_at DESC LIMIT 100`, [user.id])).rows;
    return { data: rows.map(row => ({ ...assignmentModel(row, 'my_')!, incident: incidentModel(row) })) };
  });

  // Squads that can take a task, nearest first: distance from the closest village they watch to the incident.
  app.get('/api/v1/assignees', async request => {
    authenticated(request, 'bpbd');
    const query = object(request.query ?? {});
    const incident = query.incident === undefined || query.incident === '' ? null : await getIncident(pool, String(query.incident));
    const rows = (await pool.query(`SELECT u.id, u.name, u.organization,
        COALESCE(array_agg(v.name ORDER BY v.name) FILTER (WHERE v.id IS NOT NULL), '{}') AS villages,
        min(ST_Distance(v.geom::geography, ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography)) AS distance,
        (SELECT count(*) FROM assignments a WHERE a.assignee_id = u.id AND a.status IN ${OPEN})::integer AS open
      FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id LEFT JOIN villages v ON v.id = s.village_id
      WHERE u.role = 'mpa' GROUP BY u.id ORDER BY distance NULLS LAST, u.name`, [incident?.lon ?? null, incident?.lat ?? null])).rows;
    return { data: rows.map(row => ({ id: row.id, name: row.name, organization: row.organization, villages: row.villages,
      distanceM: row.distance === null ? null : Math.round(Number(row.distance)), openAssignments: row.open })) };
  });
}
