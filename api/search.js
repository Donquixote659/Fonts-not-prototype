// api/search.js
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

// 환경변수 로드 (Vercel 환경에서는 자동으로 주입됨)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 유니코드 기반 언어 감지 함수 (기존 로드 유지)
function detectSubsets(query) {
  const subsets = ["latin"];
  const ranges = [
    { reg: /[가-힣]/, name: "korean" },
    { reg: /[ぁ-んァ-ン]/, name: "japanese" },
    { reg: /[\u0400-\u04FF]/, name: "cyrillic" },
    { reg: /[ăâđêôơư]/i, name: "vietnamese" },
  ];
  ranges.forEach(r => { if (r.reg.test(query)) subsets.push(r.name); });
  return [...new Set(subsets)];
}

// 🔥 Vercel 전용 핸들러 함수
export default async function handler(req, res) {
  // 1. CORS 설정 (Lovable 등 외부 도메인에서 접속 허용)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 2. 검색어 추출 (GET 방식: ?q=검색어 / POST 방식: { "query": "검색어" })
  const query = req.query.q || req.body?.query;

  if (!query) {
    return res.status(400).json({ error: "검색어를 입력해주세요." });
  }

  try {
    const targetSubsets = detectSubsets(query);
    const isKoreanQuery = targetSubsets.includes("korean");

    // 3. OpenAI 임베딩 생성
    const embeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query
    });
    const queryEmbedding = embeddingRes.data[0].embedding;

    // 4. Supabase DB 검색
    const { data: rawData, error } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.2,
      match_count: 50
    });

    if (error) throw error;

    // 5. 가중치 로직 적용 (기존 로직 동일)
    const searchTerms = query.split(' ').filter(t => t.length > 1);
    const scoredData = rawData.map(item => {
      let score = item.similarity;
      searchTerms.forEach(term => {
        if (item.content.includes(term)) score += 5.0; 
      });
      const itemSubsets = item.subsets || [];
      if (isKoreanQuery && itemSubsets.includes("korean")) score += 20.0;
      return { ...item, finalScore: score };
    });

    scoredData.sort((a, b) => b.finalScore - a.finalScore);

    // 6. 결과 믹싱 및 다양성 보장
    const finalResult = [];
    const providers = new Set();
    const globalCandidates = scoredData.filter(i => (i.subsets?.includes("korean")) && (i.subsets?.includes("latin")));
    
    if (globalCandidates.length > 0) {
      const pick = globalCandidates[0];
      finalResult.push(pick);
      providers.add(pick.provider);
    }

    const leftovers = scoredData.filter(i => !finalResult.find(r => r.id === i.id));
    for (const font of leftovers) {
      if (finalResult.length >= 5) break;
      if (!providers.has(font.provider) || Math.random() > 0.7) {
        finalResult.push(font);
        providers.add(font.provider);
      }
    }

    // 7. 최종 JSON 응답
    return res.status(200).json(finalResult);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "서버 내부 에러가 발생했습니다." });
  }
}