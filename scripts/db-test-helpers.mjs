import {spawnSync} from 'node:child_process';
export const container = process.env.TEST_DB_CONTAINER || 'numeric-shortener-m2-postgres';
export function sql(statement, user = 'shortener_app', expectError = false) {
  const result = spawnSync('docker', ['exec', container, 'psql', '-X', '-At',
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-U', user,
    '-d', 'numeric_shortener', '-c', statement], {encoding:'utf8'});
  if (result.error) throw new Error('Docker CLI unavailable for isolated M2 DB test');
  if (expectError) return {code:result.status, error:result.stderr};
  if (result.status !== 0) throw new Error(`M2 test query failed: ${result.stderr}`);
  return result.stdout.trim();
}
export function mappings() {
  return JSON.parse(sql(`SELECT COALESCE(json_agg(t ORDER BY id),'[]'::json) FROM
    (SELECT id::text, original_url FROM public.urls) t`));
}
