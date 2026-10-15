export class ApiError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export function requireCondition(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new ApiError(status, code, message);
}

export function object(value: unknown): Record<string, unknown> {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), 400, 'INVALID_INPUT', 'Data tidak valid.');
  return value as Record<string, unknown>;
}

export function text(value: unknown, name: string, min = 1, max = 2000): string {
  requireCondition(typeof value === 'string', 400, 'INVALID_INPUT', `${name} wajib diisi.`);
  const result = value.trim();
  requireCondition(result.length >= min && result.length <= max, 400, 'INVALID_INPUT', `${name} harus ${min}–${max} karakter.`);
  return result;
}

export function uuid(value: unknown): string {
  requireCondition(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value), 400, 'INVALID_INPUT', 'ID tidak valid.');
  return value;
}

export function choice<T extends string>(value: unknown, choices: readonly T[], name: string): T {
  requireCondition(typeof value === 'string' && choices.includes(value as T), 400, 'INVALID_INPUT', `${name} tidak valid.`);
  return value as T;
}

export function integer(value: unknown, name: string, min: number, max: number): number {
  requireCondition(typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max, 400, 'INVALID_INPUT', `${name} harus bilangan ${min}–${max}.`);
  return value;
}
