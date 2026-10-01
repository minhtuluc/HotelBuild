const invalid = (name) =>
  new Error(`${name} must provide a valid PostgreSQL connection configuration`);

function parse(value, name) {
  try {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !decodeURIComponent(url.username) ||
      !decodeURIComponent(url.pathname.slice(1)) ||
      url.pathname.slice(1).includes('/') ||
      url.search ||
      url.hash
    )
      throw invalid(name);
    decodeURIComponent(url.password);
    return url;
  } catch {
    throw invalid(name);
  }
}

const endpoint = (url) =>
  [url.hostname, url.port || '5432', decodeURIComponent(url.pathname)].join('|');

const identity = (url) =>
  [
    url.hostname,
    url.port || '5432',
    decodeURIComponent(url.pathname),
    decodeURIComponent(url.username),
  ].join('|');

/** Validate the privileged migration URL without revealing credentials. */
export function requireMigrationUrl(env = process.env) {
  const owner = parse(env.DATABASE_MIGRATION_URL, 'DATABASE_MIGRATION_URL');
  if (decodeURIComponent(owner.username) === 'app_rw') throw invalid('DATABASE_MIGRATION_URL');
  if (env.DATABASE_URL) {
    const runtime = parse(env.DATABASE_URL, 'DATABASE_URL');
    if (identity(owner) === identity(runtime)) throw invalid('DATABASE_MIGRATION_URL');
  }
  return env.DATABASE_MIGRATION_URL;
}

/** Development-only credentials for an existing runtime role. */
export function requireDevRoleConfig(env = process.env) {
  if (env.NODE_ENV === 'production') throw new Error('NODE_ENV must permit development role setup');
  const ownerUrl = requireMigrationUrl(env);
  const owner = parse(ownerUrl, 'DATABASE_MIGRATION_URL');
  const runtime = parse(env.DATABASE_URL, 'DATABASE_URL');
  for (const [url, name] of [
    [owner, 'DATABASE_MIGRATION_URL'],
    [runtime, 'DATABASE_URL'],
  ]) {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw invalid(name);
  }
  const password = decodeURIComponent(runtime.password);
  if (
    decodeURIComponent(runtime.username) !== 'app_rw' ||
    endpoint(owner) !== endpoint(runtime) ||
    !password ||
    password.includes('\0')
  )
    throw invalid('DATABASE_URL');
  return { ownerUrl, runtimeUrl: env.DATABASE_URL, password };
}
