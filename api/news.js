import { put, list } from '@vercel/blob';

function getKSTDateStr() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

const CATEGORIES = [
  { name: '정치', query: '정치 국회 정당' },
  { name: '경제', query: '경제 금융 주식' },
  { name: '사회', query: '사회 사건 사고' },
  { name: '연예/문화', query: '연예 문화 엔터테인먼트' },
  { name: 'IT·테크', query: 'IT 기술 테크 인공지능' },
  { name: '국제', query: '국제 해외 외교' }
];

async function fetchNaverNews(query) {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=3&sort=date`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
    }
  });
  const data = await res.json();
  return (data.items || []).slice(0, 2).map(item => ({
    title: item.title.replace(/<[^>]+>/g, ''),
    description: item.description.replace(/<[^>]+>/g, ''),
    url: item.originallink || item.link,
    pubDate: item.pubDate
  }));
}

async function summarizeWithClaude(categoryName, articles) {
  const articleText = articles.map((a, i) =>
    `${i+1}. 제목: ${a.title}\n내용: ${a.description}\nURL: ${a.url}`
  ).join('\n\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `아래 뉴스 중 가장 중요한 1개를 골라 JSON으로만 답해. 다른 텍스트 없이 JSON만.\n\n${articleText}\n\n형식: {"headline":"제목","summary":"2문장요약","why":"중요한이유한줄","url":"기사URL"}`
      }]
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);

  let raw = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  raw = raw.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('JSON 없음');
  return JSON.parse(raw.slice(s, e + 1));
}

async function buildBriefing() {
  const categories = [];
  for (const cat of CATEGORIES) {
    try {
      const articles = await fetchNaverNews(cat.query);
      if (articles.length === 0) continue;
      const item = await summarizeWithClaude(cat.name, articles);
      categories.push({ name: cat.name, items: [item] });
    } catch(e) {
      console.log(`${cat.name} 실패:`, e.message);
    }
  }
  return categories;
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
      } catch(e) {
        console.log('캐시 로드 실패:', e.message);
      }
    }

    try {
      const categories = await buildBriefing();
      if (categories.length === 0) throw new Error('뉴스를 가져오지 못했어요');
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
