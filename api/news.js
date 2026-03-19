import { kv } from '@vercel/kv';

function getKSTDateStr() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10); // "2026-03-19"
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const todayKey = `briefing:${getKSTDateStr()}`;

  if (req.method === 'GET') {
    try {
      const data = await kv.get(todayKey);
      if (!data) {
        return res.status(404).json({ ready: false, message: '아직 오늘 브리핑이 준비되지 않았어요' });
      }
      return res.status(200).json({ ready: true, ...data });
    } catch (e) {
      return res.status(500).json({ ready: false, message: '서버 오류' });
    }
  }

  if (req.method === 'POST') {
    if (req.headers['x-secret'] !== process.env.SAVE_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const { categories } = req.body;
      if (!Array.isArray(categories)) {
        return res.status(400).json({ error: 'categories 배열이 필요해요' });
      }
      const payload = { categories, savedAt: new Date().toISOString(), dateStr: getKSTDateStr() };
      await kv.set(todayKey, payload, { ex: 60 * 60 * 30 }); // 30시간 TTL
      return res.status(200).json({ ok: true, key: todayKey });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
