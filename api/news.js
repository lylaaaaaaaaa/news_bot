import { put, list } from '@vercel/blob';

function getKSTDateStr() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

const CATEGORIES = [
  { name: '정치', query: '정치 국회' },
  { name: '경제', query: '경제 금융' },
  { name: '사회', query: '사회 사건' },
  { name: '연예/문화', query: '연예 문화' },
  { name: 'IT·테크', query: 'IT 기술' },
  { name: '국제', query: '국제 해외' }
];

async function fetchNaverNews(query) {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=2&sort=date`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
    }
  });
  const data = await res.json();
  return (data.items || []).map(item => ({
    title: item.title.replace(/<[^>]+>/g, ''),
    description: item.description.replace(/<[^>]+>/g, ''),
    url: item.originallink || item.link
  }));
}

async function summarizeWithClaude(categoryName, articles) {
  const articleText = articles.map((a, i) =>
    `${i+1}. ${a.title}: ${a.description} (${a.url})`
  ).join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `뉴스 중 중요한 1개 골라 JSON만 출력:\n${articleText}\n\n{"headline":"제목","summary":"한줄요약","why":"이유","url":"URL"}`
      }]
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  let raw = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim();
  raw = raw.replace(/^```[a-z]*\s*/i,'').replace(/\s*```$/,'').trim();
  const s=raw.indexOf('{'), e=raw.lastIndexOf('}');
  if(s<0||e<0) throw new Error('JSON 없음');
  return JSON.parse(raw.slice(s,e+1));
}

async function processCategory(cat) {
  const articles = await fetchNaverNews(cat.query);
  if (!articles.length) return null;
  const item = await summarizeWithClaude(cat.name, articles);
  return { name: cat.name, items: [item] };
}

async function buildBriefing() {
  // 모든 카테고리 병렬 처리
  const results = await Promise.allSettled(CATEGORIES.map(cat => processCategory(cat)));
  return results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);
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
          const data = await fetchRes.json();
          if (Array.isArray(data.categories) && data.categories.length > 0) {
            return res.status(200).json({ ready: true, cached: true, ...data });
          }
        }
      } catch(e) {}
    }

    try {
      const categories = await buildBriefing();
      if (!categories.length) throw new Error('뉴스를 가져오지 못했어요');
      const payload = { categories, savedAt: new Date().toISOString(), dateStr };
      await put(filename, JSON.stringify(payload), {
        access: 'public', contentType: 'application/json', addRandomSuffix: false
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
      if (typeof categories === 'string') categories = JSON.parse(categories.replace(/^=/, ''));
      if (!Array.isArray(categories)) return res.status(400).json({ error: 'categories 배열 필요' });
      const payload = { categories, savedAt: new Date().toISOString(), dateStr };
      const blob = await put(filename, JSON.stringify(payload), {
        access: 'public', contentType: 'application/json', addRandomSuffix: false
      });
      return res.status(200).json({ ok: true, url: blob.url });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
