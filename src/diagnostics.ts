import { getSystemErrorMap } from 'node:util';
import { ConfigError } from './runtime.js';

const systemCodes = new Set([...getSystemErrorMap().values()].map(([name]) => name));
// Node's DNS, URL and TLS layers also emit codes outside libuv's error map.
for (const code of [
  'ENOTFOUND', 'ERR_INVALID_URL', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE',
  'ERR_OUT_OF_RANGE', 'ERR_SOCKET_BAD_PORT', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]) systemCodes.add(code);
const sqlStateClasses = new Set([
  '00', '01', '02', '03', '08', '09', '0A', '0B', '0F', '0L', '0P', '0Z',
  '20', '21', '22', '23', '24', '25', '26', '27', '28', '2B', '2D', '2F',
  '34', '38', '39', '3B', '3D', '3F', '40', '42', '44', '53', '54', '55',
  '57', '58', '72', 'F0', 'HV', 'P0', 'XX',
]);

export function errorCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (typeof code !== 'string') return 'UNKNOWN';
  if (systemCodes.has(code) || (/^[0-9A-Z]{5}$/.test(code) && sqlStateClasses.has(code.slice(0, 2)))) return code;
  return 'UNKNOWN';
}

export class MigrationError extends Error {
  override name = 'MigrationError';
  readonly code: string;
  readonly migration: string | undefined;

  constructor(migration: string, error: unknown) {
    super('Migration failed');
    this.code = errorCode(error);
    this.migration = /^\d+_[a-z0-9_]+\.sql$/.test(migration) ? migration : undefined;
  }
}

export function failureMessage(context: 'startup' | 'migration', error: unknown): string {
  const label = context === 'startup' ? 'Pulse could not start' : 'Database migration failed';
  // ConfigError contains only our fixed validation messages, never environment values.
  if (error instanceof ConfigError) return `${label}: ${error.message}`;
  const migration = error instanceof MigrationError && error.migration ? `; migration: ${error.migration}` : '';
  return `${label} (code: ${errorCode(error)}${migration}).`;
}
