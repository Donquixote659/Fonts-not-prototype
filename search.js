import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function detectPrimaryLang(query) {
  if (/[가-힣]/.test(query)) return "korean";
  if (/[ぁ-んァ-ン]/.test(query)) return "japanese";
  return "latin"; // 기본값
}

export default async function handler(req, res) {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = req.query.q || req.body?.query;
  if (!query) return res.status(400).json({ error: "검색어를 입력해주세요." });

  try {
    const targetLang = detectPrimaryLang(query);

    // 1. 임베딩 생성
    const embeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query
    });
    const queryEmbedding = embeddingRes.data[0].embedding;

    // 2. Supabase 하이브리드 검색 호출 (DB가 다 계산해서 5개만 딱 줌!)
    const { data: results, error } = await supabase.rpc("search_fonts_hybrid", {
      query_embedding: queryEmbedding,
      search_term: query.split(' ')[0], // 첫 번째 단어를 핵심 키워드로 사용
      target_lang: targetLang,
      match_limit: 5
    });

    if (error) throw error;

    // 3. 바로 응답
    return res.status(200).json(results);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "서버 내부 에러가 발생했습니다." });
  }
}