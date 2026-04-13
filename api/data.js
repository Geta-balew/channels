// ═══════════════════════════════════════════════════════════
// Vercel Serverless Function — GitHub as Database
// ═══════════════════════════════════════════════════════════
const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.GITHUB_OWNER;
const REPO  = process.env.GITHUB_REPO;
const FILE  = 'db.json';
const GH    = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;

const ghHeaders = {
  'Authorization': `Bearer ${TOKEN}`,
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function readDB() {
  const r = await fetch(GH, { headers: ghHeaders });
  if (r.status === 404) {
    return { db: { channels: [], sellers: [], buyers: [] }, sha: null };
  }
  if (!r.ok) throw new Error(`GitHub read error: ${r.status}`);
  const j = await r.json();
  const raw = Buffer.from(j.content.replace(/[\n\r]/g, ''), 'base64').toString('utf8');
  return { db: JSON.parse(raw), sha: j.sha };
}

async function writeDB(db, sha) {
  const content = Buffer.from(JSON.stringify(db)).toString('base64');
  const body = { message: `update ${new Date().toISOString()}`, content };
  if (sha) body.sha = sha;
  const r = await fetch(GH, {
    method: 'PUT',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.message || `GitHub write error: ${r.status}`);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not set in Vercel env vars' });

  try {
    // ── GET: load all data ──────────────────────────────────
    if (req.method === 'GET') {
      const { db } = await readDB();
      return res.status(200).json(db);
    }

    // ── POST: upsert or delete ──────────────────────────────
    if (req.method === 'POST') {
      const { action, table, item, id } = req.body;
      if (!['channels', 'sellers', 'buyers'].includes(table))
        return res.status(400).json({ error: 'Invalid table: ' + table });

      const { db, sha } = await readDB();
      if (!db[table]) db[table] = [];

      if (action === 'upsert') {
        const idx = db[table].findIndex(x => x.id === item.id);
        if (idx >= 0) db[table][idx] = item;
        else db[table].unshift(item);
      } else if (action === 'delete') {
        db[table] = db[table].filter(x => x.id !== id);
      } else {
        return res.status(400).json({ error: 'Invalid action: ' + action });
      }

      await writeDB(db, sha);
      return res.status(200).json({ ok: true, db });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[data API]', e.message);
    return res.status(500).json({ error: e.message });
  }
};
