import { put, list } from '@vercel/blob';

function getKSTDateStr() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function parseCategories(raw) {
  if (!raw) throw new Error('응답이 비어 있어요');
  let text = String(raw).trim();
  text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('JSON을 찾을 수 없어요');
  let jsonStr = text.slice(s, e + 1);
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch(e1) {
    try {
      jsonStr = jsonStr.replace(/,\s*\{[^}]*$/, '').replace(/,\s*$/, '');
      const ob = (jsonStr.match(/\{/g)||[]).length;
      const cb = (jsonStr.match(/\}/g)||[]).length;
      const oar = (jsonStr.match(/\[/g)||[]).length;
      const car = (jsonStr.match(/\]/g)||[]).length;
      jsonStr += ']'.repeat(Math.max(0, oar - car)) + '}'.repeat(Math.max(0, ob - cb));
      parsed = JSON.parse(jsonStr);
    } catch(e2) {
      throw new Error('JSON 파싱 실패: ' + e2.message);
    }
  }
  if (!Array.isArray(parsed.categories)) throw new Error('categories 없음');
  return parsed.categories;
}

async function fetchFromClaude() {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: '오늘 한국 주요 뉴스를 검색해서 아래 JSON으로만 답해. 각 카테고리당 뉴스 1개만. 설명 없이 JSON만.\n{"categories":[{"name":"정치","items":[{"headline":"제목","summary":"한문장요약","why":"이유","url":"링크"}]},{"name":"경제","items":[{"headline":"제목","summary":"한문장요약","why":"이유","url":"링크"}]},{"name":"사회","items":[{"headline":"제목","summary":"한문장요약","why":"이유","url":"링크"}]},{"name":"연예/문화","items":[{"headline":"제목","summary":"한문장요약","why":"이유","url":"링크"}]},{"name":"IT·테크","items":[{"headline":"제목","summary":"한문장요약","why":"이유","url":"링크"}]},{"name":"국제","items":[{"headline":"제목","summary":"한문장요약","why":"이유","url":"링크"}]}]}'
      }]
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);

  const raw = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  return parseCategories(raw);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const dateStr = getKSTDateStr();
  const filename = `briefing-${dateStr}.json`;

  if (req.method === 'GET') {
    const forceRefresh = req.query.refresh === '1';

    if (!forceRefresh) {
      try {
        const { blobs } = await list({ prefix: `briefing-${dateStr}` });
        if (blobs.length > 0) {
          const fetchRes = await fetch(blobs[0].url);
          const text = await fetchRes.text();
          const data = JSON.parse(text);
          // categories가 문자열이면 다시 파싱
          if (typeof data.categories === 'string') {
            data.categories = JSON.parse(data.categories);
          }
          if (!Array.isArray(data.categories)) throw new Error('배열 아님');
          return res.status(200).json({ ready: true, cached: true, ...data });
        }
      } catch(e) {
        console.log('캐시 로드 실패, 실시간 생성:', e.message);
      }
    }

    try {
      const categories = await fetchFromClaude();
      const payload = { categories, savedAt: new Date().toISOString(), dateStr };
      await put(filename, JSON.stringify(payload), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false
      });
      return res.status(200).json({ ready: true, cached: false, ...payload });
    } catch(e) {
      return res.status(500).json({ ready: false, message: e.message });
    }
  }

  if (req.method === 'POST') {
    if (req.headers['x-secret'] !== process.env.SAVE_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      let categories = req.body.categoriesJson
        ? JSON.parse(req.body.categoriesJson)
        : req.body.categories;

      if (typeof categories === 'string') {
        categories = JSON.parse(categories.replace(/^=/, ''));
      }
      if (!Array.isArray(categories)) {
        return res.status(400).json({ error: 'categories 배열이 필요해요' });
      }
      const payload = { categories, savedAt: new Date().toISOString(), dateStr };
      const blob = await put(filename, JSON.stringify(payload), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false
      });
      return res.status(200).json({ ok: true, url: blob.url });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
