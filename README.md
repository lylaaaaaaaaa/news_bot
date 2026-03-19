# 오늘의 브리핑

AI가 매일 오전 9시에 주요 뉴스를 카테고리별로 정리해주는 사이트입니다.

## 배포 구조

```
n8n (매일 KST 9시)
  → Claude API 뉴스 검색
  → Claude API JSON 변환
  → Vercel KV 저장  ←  사이트가 여기서 읽어옴
  → Gmail 이메일 발송
```

---

## 세팅 순서

### 1단계: GitHub 레포 생성
1. GitHub에서 새 레포 생성 (public or private)
2. 이 폴더 전체를 push

```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/YOUR_ID/daily-briefing.git
git push -u origin main
```

### 2단계: Vercel 배포
1. [vercel.com](https://vercel.com) 로그인 → **Add New Project**
2. GitHub 레포 연결
3. **Storage** 탭 → **KV** 생성 → 프로젝트에 연결 (환경변수 자동 추가됨)
4. **Settings → Environment Variables** 에 추가:
   - `BRIEFING_SECRET` = 아무 랜덤 문자열 (예: `my-secret-2026`)

### 3단계: n8n 워크플로우 설정
1. n8n에서 **Import workflow** → `n8n-workflow.json` 업로드
2. **Settings → Variables** 에 추가:
   - `ANTHROPIC_API_KEY` = Anthropic API 키
   - `VERCEL_SITE_URL` = `https://your-project.vercel.app` (Vercel 배포 후 확인)
   - `BRIEFING_SECRET` = Vercel에 설정한 것과 동일한 값
   - `BRIEFING_EMAIL` = 이메일 받을 주소
3. **Gmail 노드** → 계정 연동 (OAuth2)
4. 워크플로우 **활성화 ON**

### 4단계: 테스트
n8n에서 워크플로우 수동 실행 → 사이트 접속해서 결과 확인

---

## 환경변수 요약

| 위치 | 변수명 | 값 |
|------|--------|-----|
| Vercel | `BRIEFING_SECRET` | 임의 시크릿 문자열 |
| Vercel | `KV_URL` 등 | KV 연결 시 자동 추가 |
| n8n | `ANTHROPIC_API_KEY` | Anthropic 콘솔에서 발급 |
| n8n | `VERCEL_SITE_URL` | 배포된 Vercel URL |
| n8n | `BRIEFING_SECRET` | Vercel과 동일하게 |
| n8n | `BRIEFING_EMAIL` | 이메일 주소 |
