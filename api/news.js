import { put, head, getDownloadUrl } from '@vercel/blob';

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

  const filename = `briefing-${getKSTDateStr()}.json`;

  // GET: 오늘 브리핑 데이터 조회
  if (req.method === 'GET') {
    try {
      const url = `https://${process.env.BLOB_STORE_ID}.public.blob.vercel-storage.com/${filename}`;
      const fetchRes = await fetch(url);
      if (!fetchRes.ok) {
        return res.status(404).json({ ready: false, message: '아직 오늘 브리핑이 준비되지 않았어요' });
      }
      const data = await fetchRes.json();
      return res.status(200).json({ ready: true, ...data });
    } catch (e) {
      return res.status(404).json({ ready: false, message: '아직 준비되지 않았어요' });
    }
  }

  // POST: n8n에서 데이터 저장
  if (req.method === 'POST') {
    if (req.headers['x-secret'] !== process.env.SAVE_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      let categories = req.body.categories;
// 디버깅용
console.log('body:', JSON.stringify(req.body));
console.log('categories type:', typeof categories);
console.log('categories value:', JSON.stringify(categories));

if (typeof categories === 'string') {
  try { categories = JSON.parse(categories); } catch(e) {
    console.log('parse error:', e.message);
  }
}
// body 전체가 categories인 경우
if (!Array.isArray(categories) && Array.isArray(req.body)) {
  categories = req.body;
}
if (!Array.isArray(categories)) {
  return res.status(400).json({ 
    error: 'categories 배열이 필요해요', 
    received: typeof categories,
    body: JSON.stringify(req.body).slice(0, 200)
  });
}
      const payload = {
        categories,
        savedAt: new Date().toISOString(),
        dateStr: getKSTDateStr()
      };
      const blob = await put(filename, JSON.stringify(payload), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false
      });
      return res.status(200).json({ ok: true, url: blob.url });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
