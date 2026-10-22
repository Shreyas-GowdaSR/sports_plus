// Retrieval evaluation: keyword (BM25) vs vector (FAISS-style flat cosine) vs hybrid (RRF).
//
//   node scripts/eval-rag.mjs            # writes rag/eval/report.md
//   node scripts/eval-rag.mjs --sweep    # also prints a threshold sweep
//
// Question embeddings are cached in rag/eval/query-vectors.json so the evaluation can be
// re-run without an API key. The vector rankings are saved to rag/eval/node-rankings.json;
// rag/check_parity.py searches the real FAISS index with the same vectors and compares.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GoogleGenAI } from '@google/genai'
import { SETTINGS, createRetriever } from '../rag.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const evalDir = join(root, 'rag', 'eval')
const indexDir = join(root, 'knowledge', 'index')
const { questions } = JSON.parse(readFileSync(join(evalDir, 'questions.json'), 'utf8'))
const meta = JSON.parse(readFileSync(join(indexDir, 'chunks.json'), 'utf8'))

// ── Question embeddings (cached) ─────────────────────────────
const cachePath = join(evalDir, 'query-vectors.json')
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {}
const usable = cache.model === meta.model && cache.dim === meta.dim ? cache.vectors : {}
const missing = questions.map(item => item.q).filter(q => !usable[q])
if (missing.length) {
  const key = process.env.GEMINI_API_KEY ?? readFileSync(join(root, '.env.local'), 'utf8').match(/^\s*GEMINI_API_KEY\s*=\s*['"]?([^'"\r\n]+)/m)?.[1]
  if (!key) throw new Error('GEMINI_API_KEY is needed to embed new evaluation questions.')
  const gemini = new GoogleGenAI({ apiKey: key })
  for (let start = 0; start < missing.length; start += 50) {
    const batch = missing.slice(start, start + 50)
    const result = await gemini.models.embedContent({ model: meta.model, contents: batch, config: { taskType: 'RETRIEVAL_QUERY', outputDimensionality: meta.dim } })
    result.embeddings.forEach((embedding, i) => { usable[batch[i]] = Buffer.from(Float32Array.from(embedding.values).buffer).toString('base64') })
  }
  writeFileSync(cachePath, JSON.stringify({ model: meta.model, dim: meta.dim, vectors: usable }))
  console.log(`embedded ${missing.length} questions`)
}
const vectorOf = q => {
  const raw = new Float32Array(new Uint8Array(Buffer.from(usable[q], 'base64')).buffer)
  const norm = Math.hypot(...raw) || 1
  return raw.map(value => value / norm)
}

// ── Metrics ──────────────────────────────────────────────────
const onTopic = questions.filter(item => item.relevant.length)
const offTopic = questions.filter(item => !item.relevant.length)

function evaluate(settings, method) {
  const retriever = createRetriever({ indexDir, gemini: null, settings })
  const ids = item => retriever.diverse(retriever.rank(method, item.q, vectorOf(item.q)), settings.k).map(hit => retriever.chunks[hit.row].id)
  let hit1 = 0, hitK = 0, recall = 0, mrr = 0, empty = 0, onTarget = 0, returned = 0
  const misses = []
  for (const item of onTopic) {
    const got = ids(item)
    const relevant = new Set(item.relevant)
    const first = got.findIndex(id => relevant.has(id))
    if (!got.length) empty++
    if (first === 0) hit1++
    if (first >= 0) { hitK++; mrr += 1 / (first + 1) } else misses.push({ q: item.q, got: got.slice(0, 2) })
    recall += got.filter(id => relevant.has(id)).length / Math.min(relevant.size, settings.k)
    onTarget += got.filter(id => relevant.has(id) || item.relevant.some(r => r.split('#')[0] === id.split('#')[0])).length
    returned += got.length
  }
  const abstained = offTopic.filter(item => ids(item).length === 0).length
  const n = onTopic.length
  return {
    method, hit1: hit1 / n, hitK: hitK / n, recall: recall / n, mrr: mrr / n, empty: empty / n,
    onDoc: returned ? onTarget / returned : 0, abstain: abstained / offTopic.length, misses,
  }
}

const pct = value => `${(value * 100).toFixed(1)}%`
const results = ['keyword', 'vector', 'hybrid'].map(method => evaluate(SETTINGS, method))

if (process.argv.includes('--sweep')) {
  console.log('\nkeywordWeight dropBelowTop | hybrid hit@1 hit@k recall MRR right-topic | off-topic abstain')
  for (const keywordWeight of [0, 0.25, 0.5, 0.75, 1]) for (const dropBelowTop of [0.06, 0.08, 0.1]) {
    const r = evaluate({ ...SETTINGS, keywordWeight, dropBelowTop }, 'hybrid')
    console.log(`${keywordWeight.toFixed(2)}          ${dropBelowTop.toFixed(2)}       | ${pct(r.hit1)} ${pct(r.hitK)} ${pct(r.recall)} ${r.mrr.toFixed(3)} ${pct(r.onDoc)} | ${pct(r.abstain)}`)
  }
}

// Vector rankings for the FAISS parity check (top 5, thresholds off).
const unfiltered = createRetriever({ indexDir, gemini: null, settings: { ...SETTINGS, minCosine: -1, dropBelowTop: 9 } })
writeFileSync(join(evalDir, 'node-rankings.json'), JSON.stringify(Object.fromEntries(questions.map(item =>
  [item.q, unfiltered.rank('vector', item.q, vectorOf(item.q)).slice(0, 5).map(hit => hit.row)])), null, 1))

// ── Report ───────────────────────────────────────────────────
const table = [
  '| Method | Hit@1 | Hit@4 | Recall@4 | MRR | Passages from the right topic | Off-topic questions correctly answered with no passages |',
  '|---|---|---|---|---|---|---|',
  ...results.map(r => `| ${r.method} | ${pct(r.hit1)} | ${pct(r.hitK)} | ${pct(r.recall)} | ${r.mrr.toFixed(3)} | ${pct(r.onDoc)} | ${pct(r.abstain)} |`),
].join('\n')
const missLines = results.flatMap(r => r.misses.map(m => `- **${r.method}** missed: "${m.q}" → got ${m.got.length ? m.got.map(id => `\`${id}\``).join(', ') : 'nothing'}`))
const report = `# RAG retrieval evaluation

Corpus: ${meta.count} chunks from ${meta.documents} documents and ${meta.sources} cited sources · embeddings: ${meta.model} (${meta.dim} dims) · index: ${meta.faiss} · built ${meta.built}

Test set: ${onTopic.length} athlete questions with hand-labelled relevant chunks, plus ${offTopic.length} off-topic questions that should retrieve nothing (rag/eval/questions.json). The coach receives the top ${SETTINGS.k} passages (at most ${SETTINGS.perDoc} per document).

${table}

- **Hit@1 / Hit@4**: share of questions where a relevant chunk is ranked first / appears in the ${SETTINGS.k} passages sent to the coach.
- **Recall@4**: share of the relevant chunks that were retrieved (capped at ${SETTINGS.k}).
- **MRR**: mean reciprocal rank of the first relevant chunk.
- **Passages from the right topic**: share of returned passages that come from the same document as a labelled answer (a precision proxy).
- **Off-topic**: share of unrelated questions (cricket, coding, movies...) for which nothing was retrieved, so the coach is not fed irrelevant text.

Settings: minCosine ${SETTINGS.minCosine}, dropBelowTop ${SETTINGS.dropBelowTop}, RRF k ${SETTINGS.rrf}, keyword weight ${SETTINGS.keywordWeight}, candidate pool ${SETTINGS.pool}, keyword-only minimum BM25 ${SETTINGS.minBm25}.

## Misses
${missLines.join('\n') || 'None.'}
`
writeFileSync(join(evalDir, 'report.md'), report)
console.log('\n' + table + '\n')
console.log(missLines.join('\n'))
