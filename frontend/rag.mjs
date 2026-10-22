// Retrieval over the curated, cited corpus in knowledge/corpus.
//
// rag/build_index.py chunks the corpus (one chunk per cited section), embeds it with
// gemini-embedding-001 and builds a FAISS IndexFlatIP. It also writes the same
// L2-normalised vectors to knowledge/index/vectors.f32, which this module scans with the
// exact inner-product search a flat FAISS index performs, so Node needs no native addon
// (scripts/eval-rag.mjs + rag/check_parity.py confirm the rankings match FAISS).
//
// Live search ranks chunks by cosine similarity to the question embedding, keeps only
// passages above an absolute and a relative similarity gate (so off-topic questions
// retrieve nothing), and takes at most two passages per document.
// If the embedding call fails (no key, quota, timeout) it falls back to BM25 keyword search.
// A hybrid (BM25 + vector, Reciprocal Rank Fusion) is kept for evaluation: on the test set
// it ranked the right passage first less often than vector search alone (rag/eval/report.md).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const SETTINGS = {
  k: 4,               // passages sent to the coach
  perDoc: 2,          // at most this many from one document
  minCosine: 0.53,    // a passage must be at least this similar to the question
  dropBelowTop: 0.06, // ...and within this much of the best match
  pool: 20,           // hybrid (evaluation only): candidates from each ranking
  rrf: 60,            // hybrid: Reciprocal Rank Fusion constant
  keywordWeight: 1,   // hybrid: weight of the BM25 ranking (vector ranking = 1)
  minBm25: 4,         // keyword-only fallback: minimum BM25 score
  embedTimeoutMs: 3500,
}

const STOP = new Set(('a about after again all also am an and any are as at be been before being but by can could did do does doing for from get got had has have how i if in into is it its just like me more most my no not of on or our out over should so some such than that the their them then there these they this to too under up very was we were what when where which while who why will with would you your want tell give much many need eat take make day per').split(' '))
const stem = word => word.length > 4 ? word.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '') : word
export const tokenize = text => (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(word => word.length > 1 && !STOP.has(word)).map(stem)

export function createRetriever({ indexDir, gemini, settings = SETTINGS }) {
  const metaPath = join(indexDir, 'chunks.json')
  if (!existsSync(metaPath)) return null
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  const chunks = meta.chunks
  const dim = meta.dim

  let vectors = null
  const vectorPath = join(indexDir, 'vectors.f32')
  if (existsSync(vectorPath)) {
    const bytes = readFileSync(vectorPath)
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    if (copy.byteLength === chunks.length * dim * 4) vectors = new Float32Array(copy)
  }

  // BM25 (k1 1.2, b 0.75); the heading counts twice.
  const docs = chunks.map(chunk => tokenize(`${chunk.section} ${chunk.section} ${chunk.text}`))
  const avgLength = docs.reduce((sum, terms) => sum + terms.length, 0) / docs.length
  const termCounts = docs.map(terms => terms.reduce((map, term) => map.set(term, (map.get(term) ?? 0) + 1), new Map()))
  const docFreq = new Map()
  for (const counts of termCounts) for (const term of counts.keys()) docFreq.set(term, (docFreq.get(term) ?? 0) + 1)

  function keywordRank(question) {
    const terms = [...new Set(tokenize(question))]
    if (!terms.length) return []
    return termCounts.map((counts, row) => {
      let score = 0
      for (const term of terms) {
        const tf = counts.get(term); if (!tf) continue
        const df = docFreq.get(term)
        const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5))
        score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * docs[row].length / avgLength))
      }
      return { row, score }
    }).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score)
  }

  // Exact inner-product scan over normalised vectors, i.e. FAISS IndexFlatIP.
  function vectorRank(query) {
    const hits = new Array(chunks.length)
    for (let row = 0; row < chunks.length; row++) {
      let dot = 0
      const offset = row * dim
      for (let i = 0; i < dim; i++) dot += vectors[offset + i] * query[i]
      hits[row] = { row, score: dot }
    }
    return hits.sort((a, b) => b.score - a.score)
  }

  // Query embeddings: cached, time-limited, and paused after a quota error.
  const cache = new Map()
  let pausedUntil = 0
  async function embedQuery(question) {
    if (!gemini || !vectors || Date.now() < pausedUntil) return null
    const key = question.trim().toLowerCase()
    if (cache.has(key)) return cache.get(key)
    try {
      const call = gemini.models.embedContent({ model: meta.model, contents: question, config: { taskType: 'RETRIEVAL_QUERY', outputDimensionality: dim } })
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('embedding timed out')), settings.embedTimeoutMs))
      const values = (await Promise.race([call, timeout])).embeddings?.[0]?.values
      if (!values || values.length !== dim) return null
      const norm = Math.hypot(...values) || 1
      const vector = Float32Array.from(values, value => value / norm)
      if (cache.size > 500) cache.delete(cache.keys().next().value)
      cache.set(key, vector)
      return vector
    } catch (error) {
      if (/429|RESOURCE_EXHAUSTED|quota/i.test(String(error?.message))) pausedUntil = Date.now() + 60_000
      console.warn(`[rag] query embedding unavailable, using keyword search: ${String(error?.message).slice(0, 120)}`)
      return null
    }
  }

  function fuse(vectorHits, keywordHits) {
    const cosine = new Map(vectorHits.map(hit => [hit.row, hit.score]))
    const fused = new Map()
    const add = (hits, source, weight) => hits.slice(0, settings.pool).forEach((hit, rank) => {
      const entry = fused.get(hit.row) ?? { row: hit.row, score: 0, cosine: cosine.get(hit.row) ?? 0, via: [] }
      entry.score += weight / (settings.rrf + rank + 1)
      entry.via.push(source)
      fused.set(hit.row, entry)
    })
    add(vectorHits, 'vector', 1)
    add(keywordHits, 'keyword', settings.keywordWeight)
    const best = vectorHits[0]?.score ?? 0
    return [...fused.values()]
      .filter(entry => entry.cosine >= settings.minCosine && entry.cosine >= best - settings.dropBelowTop)
      .sort((a, b) => b.score - a.score)
  }

  function diverse(hits, k) {
    const perDoc = new Map()
    const picked = []
    for (const hit of hits) {
      const doc = chunks[hit.row].doc
      if ((perDoc.get(doc) ?? 0) >= settings.perDoc) continue
      perDoc.set(doc, (perDoc.get(doc) ?? 0) + 1)
      picked.push(hit)
      if (picked.length === k) break
    }
    return picked
  }

  /** Ranked rows for one method; used by search() and by the evaluation script. */
  function rank(method, question, queryVector) {
    if (method === 'keyword') return keywordRank(question).filter(hit => hit.score >= settings.minBm25)
    if (method === 'vector') {
      const hits = vectorRank(queryVector)
      return hits.filter(hit => hit.score >= settings.minCosine && hit.score >= hits[0].score - settings.dropBelowTop)
    }
    return fuse(vectorRank(queryVector), keywordRank(question))
  }

  async function search(question, k = settings.k) {
    const queryVector = await embedQuery(question)
    const mode = queryVector ? 'vector' : 'keyword'
    const hits = diverse(rank(mode, question, queryVector), k)
    return {
      mode,
      hits: hits.map(hit => {
        const chunk = chunks[hit.row]
        return { id: chunk.id, section: chunk.section, docTitle: chunk.docTitle, topic: chunk.topic, source: chunk.source, url: chunk.url, text: chunk.text, score: Number(hit.score.toFixed(4)), ...(hit.cosine !== undefined ? { cosine: Number(hit.cosine.toFixed(3)) } : {}) }
      }),
    }
  }

  return {
    chunks, embedQuery, rank, diverse, search,
    info: { chunks: chunks.length, documents: meta.documents, sources: meta.sources, model: meta.model, dim, vectors: Boolean(vectors), built: meta.built },
  }
}
