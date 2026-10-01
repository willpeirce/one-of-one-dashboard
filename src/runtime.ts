export interface RuntimeConfig {
  origin: string;
  rpId: string;
  secureCookies: boolean;
  host: string;
  port: number;
  databaseUrl: string;
  setupCode?: string;
}

export function readRuntime(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (production && !env.APP_ORIGIN) throw new Error('APP_ORIGIN is required in production');
  let url: URL;
  try { url = new URL(env.APP_ORIGIN || `http://localhost:${port}`); }
  catch { throw new Error('Invalid APP_ORIGIN'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('APP_ORIGIN must contain only a scheme, hostname and optional port');
  }
  const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localhost && !production)) {
    throw new Error('APP_ORIGIN must use HTTPS (HTTP localhost is allowed in development)');
  }
  if (env.DASHBOARD_SETUP_CODE && (env.DASHBOARD_SETUP_CODE.trim().length < 20 || env.DASHBOARD_SETUP_CODE.length > 1024)) {
    throw new Error('DASHBOARD_SETUP_CODE must contain 20 to 1024 characters');
  }
  return {
    origin: url.origin, rpId: url.hostname, secureCookies: url.protocol === 'https:',
    host: env.HOST || '127.0.0.1', port, databaseUrl: env.DATABASE_URL,
    ...(env.DASHBOARD_SETUP_CODE ? { setupCode: env.DASHBOARD_SETUP_CODE } : {}),
  };
}
