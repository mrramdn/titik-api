import type pg from 'pg';

export type Database = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;
export type Role = 'mpa' | 'kades' | 'bpbd' | 'admin';
export interface User { id: string; name: string; email: string; role: Role; organization: string; demo: boolean }

export const demoDomain = '@titikapi.test';

export function userModel(row: Record<string, any>): User {
  return { id: row.id, name: row.name, email: row.email, role: row.role, organization: row.organization, demo: String(row.email).endsWith(demoDomain) };
}
