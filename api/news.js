import { put, list } from '@vercel/blob';

function getKSTDateStr() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function fetchFromClaude() {
  // 1단계: 뉴스 검색
  const searchRes = await fetch('https://api.anthropic.com/v1/messages', {
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
        content: '오늘 한국 주요 뉴스를 검색해서 아래 JSON으로만 답해. 각 카테고리당 뉴스 1개만. 설명 없이 JSON만. url은 기사 직접 링크.\n{"categories":[{"name":"정치","items":[{"headline":"제목","summary":"한문장요약","why":"이유","url":"링크"}]},{"name":"경제","items":[{"headline":"제목","summary":"한문장요약","why":"이유","url":"링크"}]},{"name":"사회","items":[{"headline":"제목","summary":"한문장요약","why":"이유","url":"링크"}]},{"name":"연예/문화","items":[{"headline":"제목","summary":"한문장요약","why":"이유","url":"링크"}]},{"name":"IT·테크","items":[{"headline":"제목","summary":"한문장요약","why":"이유","url":"링크"}]},{"name":"국제","items":[{"headline":"제목","summary":"한문장요약","why":"이유","url":"링크"}]}]}'
      }]
    })
  });

  const searchData = await searchRes.json();
  if (searchData.error) throw new Error(searchData.error.message);

  // 텍스트 추출 + JSON 파싱
  let raw = (searchData.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  raw = raw.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('JSON을 찾을 수 없어요');

  let jsonStr = raw.slice(s, e + 1);
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch(e1) {
    // 잘린 JSON 복구
    try {
      jsonStr = jsonStr.replace(/,\s*\{[^}]*$/, '').replace(/,\s*$/, '');
      const ob = (jsonStr.match(/\{/g)||[]).length;
      const cb = (jsonStr.match(/\}/g)||[]).length;
      const oar = (jsonStr.match(/\[/g)||[]).length;
      const car = (jsonStr.match(/\]/g)||[]).length;
      jsonStr += ']'.repeat(oar - car) + '}'.repeat(ob - cb);
      parsed = JSON.parse(jsonStr);
    } catch(e2) {
      throw new Error('JSON 파싱 실패');
    }
  }

  if (!Array.isArray(parsed.categories)) throw new Error('categories 없음');
  return parsed.categories;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const dateStr = getKSTDateStr();
  const filename = `briefing-${dateStr}.json`;

  // GET: 데이터 조회 (없으면 실시간 생성)
  if (req.method === 'GET') {
    const forceRefresh = req.query.refresh === '1';

    // 저장된 데이터 먼저 확인
    if (!forceRefresh) {
      try {
        const { blobs } = await list({ prefix: `briefing-${dateStr}` });
        if (blobs.length > 0) {
          const fetchRes = await fetch(blobs[0].url);
          const data = await fetchRes.json();
          return res.status(200).json({ ready: true, cached: true, ...data });
        }
      } catch(e) {}
    }

    // 저장된 데이터 없거나 강제 새로고침 → Claude API 실시간 호출
    try {
      const categories = await fetchFromClaude();
      const payload = { categories, savedAt: new Date().toISOString(), dateStr };

      // Blob에 저장
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

  // POST: n8n에서 데이터 저장
  if (req.method === 'POST') {
    if (req.headers['x-secret'] !== process.env.SAVE_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      let categories = req.body.categoriesJson
        ? JSON.parse(req.body.categoriesJson)
        : req.body.categories;

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
