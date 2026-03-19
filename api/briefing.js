import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const KST_OFFSET = 9 * 60 * 60 * 1000;
  const nowKST = new Date(Date.now() + KST_OFFSET);
  const todayKey = `briefing:${nowKST.toISOString().slice(0, 10)}`;

  // GET: 오늘 브리핑 조회
  if (req.method === 'GET') {
    try {
      const data = await kv.get(todayKey);
      if (!data) {
        return res.status(404).json({ error: 'NOT_READY' });
      }
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: 'KV_ERROR', message: err.message });
    }
  }

  // POST: n8n에서 브리핑 저장
  if (req.method === 'POST') {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${process.env.BRIEFING_SECRET}`) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    try {
      const body = req.body;
      if (!body?.categories) {
        return res.status(400).json({ error: 'INVALID_BODY' });
      }
      const payload = {
        categories: body.categories,
        generatedAt: nowKST.toISOString(),
        dateLabel: nowKST.toLocaleDateString('ko-KR', {
          year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
        })
      };
      await kv.set(todayKey, payload, { ex: 60 * 60 * 25 });
      return res.status(200).json({ ok: true, key: todayKey });
    } catch (err) {
      return res.status(500).json({ error: 'SAVE_ERROR', message: err.message });
    }
  }

  return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
}
