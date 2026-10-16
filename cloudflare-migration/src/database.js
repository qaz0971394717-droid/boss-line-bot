import { neon } from '@neondatabase/serverless';

export const hasDatabase = env => env.DATABASE_BACKEND === 'd1'
  ? Boolean(env.BOSS_DB?.prepare) : Boolean(env.STAGING_DATABASE_URL);

// This adapter translates only syntax used by this command engine. All values
// remain bound parameters; it never interpolates user input into SQL text.
export function createSql(env) {
  if (env.DATABASE_BACKEND !== 'd1') return neon(env.STAGING_DATABASE_URL);
  if (!env.BOSS_DB?.prepare) throw new Error('D1 binding missing');
  return async (parts, ...values) => {
    let query = parts.join('?').replace(/::jsonb\b/g, '')
      .replace(/\bnow\(\)/gi, "strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    const params = values.map(value => typeof value === 'boolean' ? Number(value) : value);
    const result = await env.BOSS_DB.prepare(query).bind(...params).all();
    if (!result.success) throw new Error('D1 query failed');
    return (result.results || []).map(row => {
      if (typeof row.reply === 'string') return { ...row, reply: JSON.parse(row.reply) };
      return row;
    });
  };
}
