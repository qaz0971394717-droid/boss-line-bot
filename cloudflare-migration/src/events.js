import { neon } from '@neondatabase/serverless';

// A pending claim is deliberately never stolen or expired automatically.
// A crashed command may already have committed its write or sent a reminder.
export function createEventStore(env) {
 const sql = neon(env.STAGING_DATABASE_URL);
 return {
  async claim(id) {
   const inserted = await sql`INSERT INTO staging_line_events(event_id) VALUES(${id}) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`;
   if (inserted.length) return { state: 'new' };
   const rows = await sql`SELECT reply,delivered_at FROM staging_line_events WHERE event_id=${id}`;
   if (rows[0]?.delivered_at) return { state: 'done' };
   return rows[0]?.reply ? { state: 'ready', reply: rows[0].reply } : { state: 'pending' };
  },
  async complete(id, reply) {
   await sql`UPDATE staging_line_events SET reply=${JSON.stringify(reply)}::jsonb WHERE event_id=${id}`;
  },
  async delivered(id) {
   await sql`UPDATE staging_line_events SET delivered_at=now() WHERE event_id=${id}`;
  }
 };
}
