/**
 * Benchmark local embedding models for on-device search and task clustering.
 *
 * Usage:
 *   npm run bench-embeddings -- queries --db <copy.db> [--n 300] [--model <openrouter id>]
 *   npm run bench-embeddings -- run --db <copy.db> [--models a,b] [--corpus 10000] [--max-tokens 512]
 *
 * Data lands in evals/embedding-bench/ (gitignored evals repo).
 */

import { config as loadEnv } from 'dotenv'
loadEnv()

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import Database from 'better-sqlite3'
import { generateText } from 'ai'
import { AutoModel, AutoTokenizer, env } from '@huggingface/transformers'
import { loadCliInferenceProvider } from './cli-inference-provider'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../src/main/llm'
import { extractJsonObject } from '../src/main/services/task-miner/helpers'
import { sanitizeFtsQuery } from '../src/main/storage/utils'

const BENCH_DIR = path.join('evals', 'embedding-bench')
const QUERIES_PATH = path.join(BENCH_DIR, 'queries.json')
const CACHE_DIR = path.join(BENCH_DIR, 'cache')
const RESULTS_DIR = path.join(BENCH_DIR, 'results')
const TASK_RESULTS_DIR = path.join('evals', 'task-mining', 'results')
const CZECH = /[ěščřžýůťďňĚŠČŘŽÝŮŤĎŇ]/
const NEAR_DUP_MS = 10 * 60 * 1000
const TOP_K = 10
const RRF_K = 60
const CLUSTER_THRESHOLD = 0.65
const GROUP_CAP = 25
let batchSize = 16

interface Candidate {
  id: string
  repo: string
  dtype: 'fp32' | 'q8'
  pooling: 'mean' | 'cls' | 'model'
  dims: number[]
  queryPrefix: string
  docPrefix: string
  clusterPrefix: string
}

const CANDIDATES: Candidate[] = [
  {
    id: 'minilm-l6-fp32',
    repo: 'Xenova/all-MiniLM-L6-v2',
    dtype: 'fp32',
    pooling: 'mean',
    dims: [384],
    queryPrefix: '',
    docPrefix: '',
    clusterPrefix: '',
  },
  {
    id: 'minilm-l6-q8',
    repo: 'Xenova/all-MiniLM-L6-v2',
    dtype: 'q8',
    pooling: 'mean',
    dims: [384],
    queryPrefix: '',
    docPrefix: '',
    clusterPrefix: '',
  },
  {
    id: 'e5-small-q8',
    repo: 'Xenova/multilingual-e5-small',
    dtype: 'q8',
    pooling: 'mean',
    dims: [384],
    queryPrefix: 'query: ',
    docPrefix: 'passage: ',
    clusterPrefix: 'query: ',
  },
  {
    id: 'granite-97m-q8',
    repo: 'onnx-community/granite-embedding-97m-multilingual-r2-ONNX',
    dtype: 'q8',
    pooling: 'cls',
    dims: [384],
    queryPrefix: '',
    docPrefix: '',
    clusterPrefix: '',
  },
  {
    id: 'granite-311m-q8',
    repo: 'onnx-community/granite-embedding-311m-multilingual-r2-ONNX',
    dtype: 'q8',
    pooling: 'cls',
    dims: [768, 384],
    queryPrefix: '',
    docPrefix: '',
    clusterPrefix: '',
  },
  {
    id: 'harrier-270m-q8',
    repo: 'onnx-community/harrier-oss-v1-270m-ONNX',
    dtype: 'q8',
    pooling: 'model',
    dims: [640],
    queryPrefix:
      'Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: ',
    docPrefix: '',
    clusterPrefix: 'Instruct: Retrieve semantically similar text\nQuery: ',
  },
  {
    id: 'embeddinggemma2-q8',
    repo: 'onnx-community/embeddinggemma-2-ONNX',
    dtype: 'q8',
    pooling: 'model',
    dims: [768, 256],
    queryPrefix: 'task: search result | query: ',
    docPrefix: 'title: none | text: ',
    clusterPrefix: 'task: clustering | query: ',
  },
]

interface ActivityRow {
  id: string
  start: number
  app: string
  title: string
  summary: string
  ocr: string
  summaryModel: string
}

type EmbedSource = 'summary' | 'ocr'

interface Target {
  activityId: string
  embedSource: EmbedSource
  czechScreen: boolean
  queries: { en: string; cs: string }
}

interface QueryFile {
  generatedAt: string
  model: string
  seed: number
  targets: Target[]
}

function parseArgs(argv: string[]): { command: string; flags: Map<string, string> } {
  const [command = '', ...rest] = argv
  const flags = new Map<string, string>()
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) continue
    const next = rest[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(rest[i].slice(2), next)
      i++
    } else {
      flags.set(rest[i].slice(2), 'true')
    }
  }
  return { command, flags }
}

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function loadActivities(dbPath: string): ActivityRow[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  const rows = db
    .prepare(
      `SELECT id, start_timestamp AS start, app_name AS app, window_title AS title,
              summary, ocr_text AS ocr, summary_model AS summaryModel
       FROM activities ORDER BY start_timestamp`,
    )
    .all() as ActivityRow[]
  db.close()
  return rows
}

function embedSource(a: ActivityRow): EmbedSource {
  if (a.summaryModel.startsWith('heuristic:')) return a.ocr ? 'ocr' : 'summary'
  return a.summary ? 'summary' : 'ocr'
}

function currentText(a: ActivityRow): string {
  return embedSource(a) === 'summary' ? a.summary : a.ocr
}

function contextText(a: ActivityRow): string {
  return [a.app, a.title].filter(Boolean).join(' — ') + '\n' + currentText(a)
}

const TEXT_VARIANTS: Record<string, (a: ActivityRow) => string> = {
  current: currentText,
  context: contextText,
}

function sampleStratified(rows: ActivityRow[], n: number, rand: () => number): ActivityRow[] {
  const byApp = new Map<string, ActivityRow[]>()
  for (const r of shuffle(rows, rand)) {
    const list = byApp.get(r.app) ?? []
    list.push(r)
    byApp.set(r.app, list)
  }
  const queues = shuffle([...byApp.values()], rand)
  const picked: ActivityRow[] = []
  while (picked.length < n && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const next = q.shift()
      if (next) picked.push(next)
      if (picked.length >= n) break
    }
  }
  return picked
}

function queryPrompt(a: ActivityRow): string {
  const content =
    embedSource(a) === 'summary'
      ? `Summary: ${a.summary}`
      : `Screen text (excerpt, may include other windows): ${a.ocr.slice(0, 1500)}`
  return `You are helping build a search benchmark for a personal history of screen activity. Below is one recorded moment of a user's computer use. Write the search query this user might type weeks later to find this moment again.

Rules:
- 3 to 8 words, the way people type into a search box.
- Refer to what they would remember: the task, person, document, topic or site. Not incidental UI details.
- Base it on the main content of this moment. Ignore background windows and app chrome.
- Paraphrase. Do not copy distinctive phrases from the summary or screen text; at most one exact proper name.
- Give an English query and a Czech query (natural Czech, not a word-for-word translation).

Return JSON only: {"en": "...", "cs": "..."}

App: ${a.app}
Window title: ${a.title}
${content}`
}

async function buildQueries(flags: Map<string, string>): Promise<void> {
  const dbPath = requireFlag(flags, 'db')
  const n = Number(flags.get('n') ?? 300)
  const seed = Number(flags.get('seed') ?? 1)
  const model = flags.get('model') ?? 'google/gemini-3.1-flash-lite'
  const rand = rng(seed)

  const rows = loadActivities(dbPath)
  const summaryRows = rows.filter((r) => embedSource(r) === 'summary' && r.summary.length > 40)
  const ocrRows = rows.filter((r) => embedSource(r) === 'ocr' && r.ocr.length > 80)
  const third = Math.round(n / 3)
  const targets = [
    ...sampleStratified(
      summaryRows.filter((r) => CZECH.test(r.ocr)),
      third,
      rand,
    ),
    ...sampleStratified(
      summaryRows.filter((r) => !CZECH.test(r.ocr)),
      third,
      rand,
    ),
    ...sampleStratified(ocrRows, n - 2 * third, rand),
  ]

  const handle = loadCliInferenceProvider({ vendorOverride: flags.get('vendor') ?? 'openrouter' })
  const out: Target[] = []
  let failed = 0
  await mapConcurrent(targets, 8, async (a) => {
    try {
      const result = await generateText({
        model: handle.provider.languageModel(model),
        timeout: DEFAULT_REQUEST_TIMEOUT_MS,
        messages: [{ role: 'user', content: queryPrompt(a) }],
      })
      const parsed = extractJsonObject<{ en?: string; cs?: string }>(result.text)
      if (!parsed?.en || !parsed.cs) throw new Error(`unparseable: ${result.text.slice(0, 200)}`)
      out.push({
        activityId: a.id,
        embedSource: embedSource(a),
        czechScreen: CZECH.test(a.ocr),
        queries: { en: parsed.en.trim(), cs: parsed.cs.trim() },
      })
    } catch (err) {
      failed++
      console.warn(`  ${a.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
    if ((out.length + failed) % 25 === 0) console.log(`  ${out.length + failed}/${targets.length}`)
  })

  const order = new Map(targets.map((t, i) => [t.id, i]))
  out.sort((x, y) => order.get(x.activityId)! - order.get(y.activityId)!)
  fs.mkdirSync(BENCH_DIR, { recursive: true })
  const file: QueryFile = { generatedAt: new Date().toISOString(), model, seed, targets: out }
  fs.writeFileSync(QUERIES_PATH, JSON.stringify(file, null, 2))
  console.log(`Wrote ${out.length} targets (${failed} failed) to ${QUERIES_PATH}`)
}

async function mapConcurrent<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) await fn(items[next++])
    }),
  )
}

function requireFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name)
  if (!value) throw new Error(`--${name} is required`)
  return value
}

interface LoadedModel {
  embed(texts: string[], maxTokens: number): Promise<Float32Array[]>
  loadMs: number
  diskMb: number
}

async function loadModel(c: Candidate, threads: number): Promise<LoadedModel> {
  const t0 = Date.now()
  const tokenizer = await AutoTokenizer.from_pretrained(c.repo)
  const model = await AutoModel.from_pretrained(c.repo, {
    dtype: c.dtype,
    session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 },
  })
  const loadMs = Date.now() - t0

  const onnxDir = path.join(env.cacheDir ?? '', c.repo, 'onnx')
  const stem = c.dtype === 'fp32' ? 'model.onnx' : 'model_quantized.onnx'
  const diskMb = fs.existsSync(onnxDir)
    ? fs
        .readdirSync(onnxDir)
        .filter((f) => f.startsWith(stem))
        .reduce((sum, f) => sum + fs.statSync(path.join(onnxDir, f)).size, 0) / 1e6
    : NaN

  async function embed(texts: string[], maxTokens: number): Promise<Float32Array[]> {
    const inputs = tokenizer(texts, { padding: true, truncation: true, max_length: maxTokens })
    const output = await model(inputs)
    if (c.pooling === 'model') return rows(output.sentence_embedding)
    const hidden = output.last_hidden_state
    const [batch, seq, dim] = hidden.dims as number[]
    const data = hidden.data as Float32Array
    const mask = inputs.attention_mask.data as BigInt64Array
    const result: Float32Array[] = []
    for (let b = 0; b < batch; b++) {
      const v = new Float32Array(dim)
      if (c.pooling === 'cls') {
        v.set(data.subarray(b * seq * dim, b * seq * dim + dim))
      } else {
        let count = 0
        for (let t = 0; t < seq; t++) {
          if (!mask[b * seq + t]) continue
          count++
          const off = (b * seq + t) * dim
          for (let d = 0; d < dim; d++) v[d] += data[off + d]
        }
        for (let d = 0; d < dim; d++) v[d] /= Math.max(count, 1)
      }
      result.push(v)
    }
    return result
  }

  return { embed, loadMs, diskMb }
}

function rows(tensor: { dims: number[]; data: Float32Array }): Float32Array[] {
  const [batch, dim] = tensor.dims
  return Array.from({ length: batch }, (_, b) => tensor.data.slice(b * dim, (b + 1) * dim))
}

function normalize(v: Float32Array, dim: number): Float32Array {
  const out = v.slice(0, dim)
  let norm = 0
  for (let i = 0; i < dim; i++) norm += out[i] * out[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < dim; i++) out[i] /= norm
  return out
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

async function embedAll(
  m: LoadedModel,
  texts: string[],
  maxTokens: number,
): Promise<{ vectors: Float32Array[]; msPerText: number }> {
  const order = texts.map((t, i) => ({ t, i })).sort((x, y) => y.t.length - x.t.length)
  const vectors: Float32Array[] = new Array(texts.length)
  const t0 = Date.now()
  for (let s = 0; s < order.length; s += batchSize) {
    const chunk = order.slice(s, s + batchSize)
    const out = await m.embed(
      chunk.map((e) => e.t),
      maxTokens,
    )
    chunk.forEach((e, k) => (vectors[e.i] = out[k]))
    if ((s / batchSize) % 50 === 0) process.stdout.write(`\r    ${s}/${texts.length}`)
  }
  process.stdout.write('\r')
  return { vectors, msPerText: (Date.now() - t0) / Math.max(texts.length, 1) }
}

async function cachedEmbed(
  key: string,
  model: LazyModel,
  texts: string[],
  maxTokens: number,
): Promise<{ vectors: Float32Array[]; msPerText: number }> {
  const hash = crypto.createHash('sha1').update(texts.join('\u0000')).digest('hex').slice(0, 12)
  const binPath = path.join(CACHE_DIR, `${key}.${maxTokens}.${hash}.bin`)
  const metaPath = binPath.replace(/\.bin$/, '.json')
  if (fs.existsSync(binPath) && fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { dim: number; msPerText: number }
    const buf = fs.readFileSync(binPath)
    const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
    const vectors = Array.from({ length: texts.length }, (_, i) =>
      all.slice(i * meta.dim, (i + 1) * meta.dim),
    )
    return { vectors, msPerText: meta.msPerText }
  }
  const result = await embedAll(await model.get(), texts, maxTokens)
  const dim = result.vectors[0]?.length ?? 0
  const flat = new Float32Array(result.vectors.length * dim)
  result.vectors.forEach((v, i) => flat.set(v, i * dim))
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(binPath, Buffer.from(flat.buffer))
  fs.writeFileSync(metaPath, JSON.stringify({ dim, msPerText: result.msPerText }))
  return result
}

interface LazyModel {
  get(): Promise<LoadedModel>
  current(): LoadedModel | null
}

function lazyModel(c: Candidate, threads: number): LazyModel {
  let loaded: LoadedModel | null = null
  return {
    get: async () => {
      if (!loaded) loaded = await loadModel(c, threads)
      return loaded
    },
    current: () => loaded,
  }
}

interface SearchQuery {
  text: string
  lang: 'en' | 'cs'
  target: Target
  accept: Set<string>
}

interface Segment {
  name: string
  test: (q: SearchQuery) => boolean
}

const SEGMENTS: Segment[] = [
  { name: 'all', test: () => true },
  { name: 'en-query', test: (q) => q.lang === 'en' },
  { name: 'cs-query', test: (q) => q.lang === 'cs' },
  { name: 'cz-screen', test: (q) => q.target.czechScreen },
  { name: 'ocr-embedded', test: (q) => q.target.embedSource === 'ocr' },
]

interface Scores {
  mrr: number
  r1: number
  r10: number
  n: number
}

function score(queries: SearchQuery[], ranked: string[][]): Record<string, Scores> {
  const out: Record<string, Scores> = {}
  for (const seg of SEGMENTS) {
    let mrr = 0
    let r1 = 0
    let r10 = 0
    let n = 0
    queries.forEach((q, i) => {
      if (!seg.test(q)) return
      n++
      const rank = ranked[i].slice(0, TOP_K).findIndex((id) => q.accept.has(id))
      if (rank >= 0) {
        mrr += 1 / (rank + 1)
        r10++
        if (rank === 0) r1++
      }
    })
    out[seg.name] = { mrr: mrr / n, r1: r1 / n, r10: r10 / n, n }
  }
  return out
}

function vectorRank(query: Float32Array, docs: Float32Array[], ids: string[], k: number): string[] {
  const scored = docs.map((d, i) => ({ id: ids[i], s: dot(query, d) }))
  scored.sort((a, b) => b.s - a.s)
  return scored.slice(0, k).map((e) => e.id)
}

function currentHybrid(vector: string[], fts: string[]): string[] {
  const seen = new Set(vector.slice(0, TOP_K))
  const merged = vector.slice(0, TOP_K)
  for (const id of fts) if (!seen.has(id)) merged.push(id)
  return merged.slice(0, TOP_K)
}

function rrf(lists: string[][]): string[] {
  const scores = new Map<string, number>()
  for (const list of lists) {
    list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1)))
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

type FtsMode = 'and' | 'or' | 'or-weighted'
type FtsSearch = (q: string, k: number, mode: FtsMode) => string[]

function buildFts(corpus: ActivityRow[]): FtsSearch {
  const db = new Database(':memory:')
  db.exec('CREATE VIRTUAL TABLE fts USING fts5(id UNINDEXED, summary, ocr_text)')
  const insert = db.prepare('INSERT INTO fts (id, summary, ocr_text) VALUES (?, ?, ?)')
  db.transaction(() => corpus.forEach((a) => insert.run(a.id, a.summary, a.ocr)))()
  const search = db.prepare('SELECT id FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT ?')
  const weighted = db.prepare(
    'SELECT id FROM fts WHERE fts MATCH ? ORDER BY bm25(fts, 0, 1.0, 0.4) LIMIT ?',
  )
  return (q, k, mode) => {
    const safe = sanitizeFtsQuery(q)
    const match = mode === 'and' ? safe : safe.split(' ').join(' OR ')
    const stmt = mode === 'or-weighted' ? weighted : search
    return (stmt.all(match, k) as { id: string }[]).map((r) => r.id)
  }
}

interface ClusterSet {
  name: string
  texts: string[]
  groups: number[]
}

function loadClusterSets(dbPath: string, rand: () => number): ClusterSet[] {
  const sets: ClusterSet[] = []

  const groups = new Map<string, Set<string>>()
  if (fs.existsSync(TASK_RESULTS_DIR)) {
    for (const file of fs.readdirSync(TASK_RESULTS_DIR).filter((f) => f.endsWith('.json'))) {
      const run = JSON.parse(fs.readFileSync(path.join(TASK_RESULTS_DIR, file), 'utf8')) as {
        fixtures?: {
          goldenScores?: { goldenTitle: string; found: boolean; matchedTitle?: string }[]
        }[]
      }
      for (const fx of run.fixtures ?? []) {
        for (const g of fx.goldenScores ?? []) {
          if (!g.found || !g.matchedTitle?.trim()) continue
          const set = groups.get(g.goldenTitle) ?? new Set<string>()
          set.add(g.matchedTitle.trim())
          groups.set(g.goldenTitle, set)
        }
      }
    }
  }
  const evalSet: ClusterSet = { name: 'eval-goldens', texts: [], groups: [] }
  ;[...groups.values()].forEach((texts, gi) => {
    if (texts.size < 2) return
    for (const t of shuffle([...texts], rand).slice(0, GROUP_CAP)) {
      evalSet.texts.push(t)
      evalSet.groups.push(gi)
    }
  })
  if (evalSet.texts.length > 0) sets.push(evalSet)

  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  const rowsOut = db
    .prepare(
      `SELECT cs.cluster_id AS clusterId, s.title, s.description
       FROM cluster_sightings cs
       JOIN clusters c ON c.id = cs.cluster_id
       JOIN sightings s ON s.id = cs.sighting_id
       WHERE c.label <> ''
         AND cs.cluster_id IN (SELECT cluster_id FROM cluster_sightings GROUP BY cluster_id HAVING COUNT(*) >= 2)`,
    )
    .all() as { clusterId: string; title: string; description: string }[]
  db.close()
  const clusterIndex = new Map<string, number>()
  const prodSet: ClusterSet = { name: 'prod-clusters', texts: [], groups: [] }
  for (const r of rowsOut) {
    if (!clusterIndex.has(r.clusterId)) clusterIndex.set(r.clusterId, clusterIndex.size)
    prodSet.texts.push([r.title, r.description].filter((t) => t.trim()).join('. '))
    prodSet.groups.push(clusterIndex.get(r.clusterId)!)
  }
  if (prodSet.texts.length > 0) sets.push(prodSet)
  return sets
}

interface ClusterScores {
  pairs: number
  positives: number
  auc: number
  bestF1: number
  bestThreshold: number
  f1AtCurrent: number
  posMean: number
  negMean: number
}

function scoreClusters(vectors: Float32Array[], groups: number[]): ClusterScores {
  const sims: { s: number; pos: boolean }[] = []
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      sims.push({ s: dot(vectors[i], vectors[j]), pos: groups[i] === groups[j] })
    }
  }
  sims.sort((a, b) => b.s - a.s)
  const P = sims.filter((e) => e.pos).length
  const N = sims.length - P

  let tp = 0
  let fp = 0
  let bestF1 = 0
  let bestThreshold = 1
  let f1AtCurrent = 0
  let rankSumNeg = 0
  let posSeen = 0
  for (const e of sims) {
    if (e.pos) {
      tp++
      posSeen++
    } else {
      fp++
      rankSumNeg += posSeen
    }
    const f1 = (2 * tp) / (2 * tp + fp + (P - tp))
    if (f1 > bestF1) {
      bestF1 = f1
      bestThreshold = e.s
    }
    if (e.s >= CLUSTER_THRESHOLD) f1AtCurrent = f1
  }
  const mean = (pos: boolean): number => {
    const list = sims.filter((e) => e.pos === pos)
    return list.reduce((s, e) => s + e.s, 0) / Math.max(list.length, 1)
  }
  return {
    pairs: sims.length,
    positives: P,
    auc: rankSumNeg / Math.max(P * N, 1),
    bestF1,
    bestThreshold,
    f1AtCurrent,
    posMean: mean(true),
    negMean: mean(false),
  }
}

interface SearchResult {
  candidate: string
  dim: number
  variant: string
  ranker: string
  scores: Record<string, Scores>
}

interface CostResult {
  candidate: string
  loadMs: number
  diskMb: number
  msPerDoc: number
  bytesPerVector: number[]
}

interface ClusterResult {
  candidate: string
  dim: number
  set: string
  scores: ClusterScores
}

async function run(flags: Map<string, string>): Promise<void> {
  const dbPath = requireFlag(flags, 'db')
  const corpusSize = Number(flags.get('corpus') ?? 10000)
  const maxTokens = Number(flags.get('max-tokens') ?? 512)
  const seed = Number(flags.get('seed') ?? 1)
  const threads = Number(
    flags.get('threads') ?? Math.max(1, Math.floor(os.availableParallelism() / 2)),
  )
  const wanted = flags.get('models')?.split(',')
  const candidates = wanted ? CANDIDATES.filter((c) => wanted.includes(c.id)) : CANDIDATES
  batchSize = Number(flags.get('batch') ?? batchSize)
  const skipSearch = flags.has('skip-search')
  const skipCluster = flags.has('skip-cluster')
  env.cacheDir = flags.get('model-cache') ?? path.join(BENCH_DIR, 'models')
  const rand = rng(seed)

  const activities = loadActivities(dbPath)
  const byId = new Map(activities.map((a) => [a.id, a]))

  const queries: SearchQuery[] = []
  let corpus: ActivityRow[] = []
  let ftsSearch: FtsSearch | null = null
  if (!skipSearch) {
    const qf = JSON.parse(fs.readFileSync(QUERIES_PATH, 'utf8')) as QueryFile
    const targets = qf.targets.filter((t) => byId.has(t.activityId))
    const targetIds = new Set(targets.map((t) => t.activityId))
    const pool = activities.filter((a) => !targetIds.has(a.id) && currentText(a).trim())
    corpus = [
      ...targets.map((t) => byId.get(t.activityId)!),
      ...shuffle(pool, rand).slice(0, corpusSize),
    ]
    const corpusIds = new Set(corpus.map((a) => a.id))
    for (const t of targets) {
      const a = byId.get(t.activityId)!
      const accept = new Set(
        activities
          .filter(
            (o) =>
              corpusIds.has(o.id) &&
              (o.id === a.id ||
                (o.app === a.app &&
                  o.title === a.title &&
                  Math.abs(o.start - a.start) <= NEAR_DUP_MS)),
          )
          .map((o) => o.id),
      )
      queries.push({ text: t.queries.en, lang: 'en', target: t, accept })
      queries.push({ text: t.queries.cs, lang: 'cs', target: t, accept })
    }
    ftsSearch = buildFts(corpus)
    console.log(`Corpus ${corpus.length} activities, ${queries.length} queries (from ${qf.model})`)
  }

  const clusterSets = skipCluster ? [] : loadClusterSets(dbPath, rand)
  for (const s of clusterSets) {
    console.log(
      `Cluster set ${s.name}: ${s.texts.length} sightings, ${new Set(s.groups).size} groups`,
    )
  }

  const search: SearchResult[] = []
  const costs: CostResult[] = []
  const clusters: ClusterResult[] = []

  if (ftsSearch) {
    for (const mode of ['and', 'or', 'or-weighted'] as const) {
      const ranked = queries.map((q) => ftsSearch!(q.text, TOP_K, mode))
      search.push({
        candidate: 'fts5',
        dim: 0,
        variant: '-',
        ranker: `fts-${mode}`,
        scores: score(queries, ranked),
      })
    }
  }

  for (const c of candidates) {
    console.log(`\n== ${c.id}`)
    const model = lazyModel(c, threads)
    const corpusIds = corpus.map((a) => a.id)
    let msPerDoc = NaN

    if (!skipSearch) {
      const qOut = await cachedEmbed(
        `${c.id}.queries`,
        model,
        queries.map((q) => c.queryPrefix + q.text),
        maxTokens,
      )
      const ftsAnd = queries.map((q) => ftsSearch!(q.text, 50, 'and'))
      const ftsOr = queries.map((q) => ftsSearch!(q.text, 50, 'or'))
      const ftsOrWeighted = queries.map((q) => ftsSearch!(q.text, 50, 'or-weighted'))
      for (const [variant, toText] of Object.entries(TEXT_VARIANTS)) {
        const dOut = await cachedEmbed(
          `${c.id}.${variant}`,
          model,
          corpus.map((a) => c.docPrefix + toText(a)),
          maxTokens,
        )
        if (variant === 'current') msPerDoc = dOut.msPerText
        for (const dim of c.dims) {
          const docs = dOut.vectors.map((v) => normalize(v, dim))
          const vecRanked = qOut.vectors.map((v) =>
            vectorRank(normalize(v, dim), docs, corpusIds, 50),
          )
          const runs: Record<string, string[][]> = {
            vector: vecRanked,
            'hybrid-current': vecRanked.map((v, i) => currentHybrid(v, ftsAnd[i])),
            'rrf-and': vecRanked.map((v, i) => rrf([v, ftsAnd[i]])),
            'rrf-or': vecRanked.map((v, i) => rrf([v, ftsOr[i]])),
            'rrf-or-weighted': vecRanked.map((v, i) => rrf([v, ftsOrWeighted[i]])),
          }
          for (const [ranker, ranked] of Object.entries(runs)) {
            search.push({ candidate: c.id, dim, variant, ranker, scores: score(queries, ranked) })
          }
          const all = score(queries, vecRanked).all
          console.log(
            `  ${variant} d${dim}: vector MRR ${all.mrr.toFixed(3)} R@10 ${all.r10.toFixed(3)}`,
          )
        }
      }
    }

    for (const s of clusterSets) {
      const out = await cachedEmbed(
        `${c.id}.cluster-${s.name}`,
        model,
        s.texts.map((t) => c.clusterPrefix + t),
        maxTokens,
      )
      for (const dim of c.dims) {
        const scores = scoreClusters(
          out.vectors.map((v) => normalize(v, dim)),
          s.groups,
        )
        clusters.push({ candidate: c.id, dim, set: s.name, scores })
        console.log(
          `  ${s.name} d${dim}: AUC ${scores.auc.toFixed(3)} bestF1 ${scores.bestF1.toFixed(3)} @${scores.bestThreshold.toFixed(2)} F1@0.65 ${scores.f1AtCurrent.toFixed(3)}`,
        )
      }
    }

    const used = model.current()
    costs.push({
      candidate: c.id,
      loadMs: used?.loadMs ?? NaN,
      diskMb: used?.diskMb ?? NaN,
      msPerDoc,
      bytesPerVector: c.dims.map((d) => d * 4),
    })
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  const meta = {
    generatedAt: stamp,
    dbPath,
    corpusSize: corpus.length,
    queries: queries.length,
    maxTokens,
    seed,
    threads,
  }
  fs.writeFileSync(
    path.join(RESULTS_DIR, `${stamp}.json`),
    JSON.stringify({ meta, search, clusters, costs }, null, 2),
  )
  const md = renderMarkdown(meta, search, clusters, costs)
  fs.writeFileSync(path.join(RESULTS_DIR, `${stamp}.md`), md)
  console.log(`\n${md}\nWrote ${path.join(RESULTS_DIR, stamp)}.{json,md}`)
}

function renderMarkdown(
  meta: Record<string, unknown>,
  search: SearchResult[],
  clusters: ClusterResult[],
  costs: CostResult[],
): string {
  const f = (x: number): string => (Number.isFinite(x) ? x.toFixed(3) : '—')
  const lines: string[] = [`Run ${JSON.stringify(meta)}`, '']
  if (search.length > 0) {
    lines.push(
      '### Search (MRR@10 per segment, R@10 overall)',
      '',
      `| model | dim | text | ranker | ${SEGMENTS.map((s) => s.name).join(' | ')} | R@10 |`,
      `|---|---|---|---|${SEGMENTS.map(() => '---').join('|')}|---|`,
    )
    for (const r of search) {
      lines.push(
        `| ${r.candidate} | ${r.dim || '—'} | ${r.variant} | ${r.ranker} | ${SEGMENTS.map((s) => f(r.scores[s.name].mrr)).join(' | ')} | ${f(r.scores.all.r10)} |`,
      )
    }
    lines.push('')
  }
  if (clusters.length > 0) {
    lines.push(
      '### Clustering (sighting pairs)',
      '',
      '| model | dim | set | AUC | best F1 | best threshold | F1 @0.65 | pos mean | neg mean |',
      '|---|---|---|---|---|---|---|---|---|',
    )
    for (const r of clusters) {
      const s = r.scores
      lines.push(
        `| ${r.candidate} | ${r.dim} | ${r.set} | ${f(s.auc)} | ${f(s.bestF1)} | ${s.bestThreshold.toFixed(2)} | ${f(s.f1AtCurrent)} | ${f(s.posMean)} | ${f(s.negMean)} |`,
      )
    }
    lines.push('')
  }
  lines.push(
    '### Cost',
    '',
    '| model | disk MB | load ms | ms/doc | bytes/vector |',
    '|---|---|---|---|---|',
  )
  for (const c of costs) {
    lines.push(
      `| ${c.candidate} | ${Number.isFinite(c.diskMb) ? c.diskMb.toFixed(0) : '—'} | ${Number.isFinite(c.loadMs) ? c.loadMs : '—'} | ${Number.isFinite(c.msPerDoc) ? c.msPerDoc.toFixed(1) : '—'} | ${c.bytesPerVector.join(' / ')} |`,
    )
  }
  return lines.join('\n')
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2))
  if (command === 'queries') return buildQueries(flags)
  if (command === 'run') return run(flags)
  console.error('Usage: bench-embeddings <queries|run> --db <path> [flags]')
  process.exit(1)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
