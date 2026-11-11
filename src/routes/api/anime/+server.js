// @ts-nocheck
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import 'dotenv/config';
import { json } from '@sveltejs/kit';
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

console.log('URL gesetzt?', !!url);

const db = createClient({ url, authToken });

async function ensureTable() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS anime (
      id TEXT PRIMARY KEY,
      name TEXT,
      image TEXT,
      description TEXT,
      was_watched INTEGER
    )
  `);
}

export async function GET() {
  try {
    await ensureTable();
    const rs = await db.execute('SELECT * FROM anime');
    const animeList = rs.rows.map(row => ({
      id: Number(row.id),
      name: row.name,
      image: row.image,
      description: row.description,
      wasWatched: Boolean(row.was_watched)
    }));
    return json(animeList);
  } catch (error) {
    console.error('DB Read Error:', error);
    return json({ error: error.message }, { status: 500 });
  }
}

export async function POST({ request }) {
  try {
    await ensureTable();
    const list = await request.json();
    
    await db.execute('DELETE FROM anime');
    for (const a of list) {
      await db.execute({
        sql: 'INSERT INTO anime (id, name, image, description, was_watched) VALUES (?, ?, ?, ?, ?)',
        args: [String(a.id), a.name, a.image, a.description, a.wasWatched ? 1 : 0]
      });
    }
    
    return json({ success: true });
  } catch (error) {
    console.error('DB Write Error:', error);
    return json({ error: error.message }, { status: 500 });
  }
}