import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { VENDOR_PRESETS, buildModelChain } from '../src/shared/vendor-defaults'
import { DefaultActivityTransformer } from '../src/main/activity-transformer'
import { FfmpegVideoStitcher } from '../src/main/video/video-stitcher'
import {
  ActivitySemanticService,
  type SemanticFileDebugDumper,
  type SemanticPipelinePreference,
} from '../src/main/activity-semantic-service'
import { activityOcrService } from '../src/main/processor/ocr'
import {
  replayFixture,
  StubEmbeddingService,
  StubOcrService,
} from '../src/main/eval/replay-harness'
import type { InferenceProvider } from '../src/main/llm'
import type { Vendor } from '../src/shared/types'
import type { ReplayActivity, ProducerStats } from '../src/main/eval/types'

/**
 * Replays one fixture through the real pipeline for a given model. Shared by the
 * eval scorer and the promote seeder so the semantic-service + transformer
 * wiring (and its cleanup) lives in exactly one place.
 */
export async function replayCell(params: {
  provider: InferenceProvider
  vendor: Vendor
  fixtureDir: string
  model: string
  pipeline: SemanticPipelinePreference
  dumper?: SemanticFileDebugDumper
  /** Run real OCR (feeds the judge's ground-truth channel). Off by default —
   *  OCR never affects the summary itself, so eval skips the Vision call. */
  ocr?: boolean
}): Promise<{ activities: ReplayActivity[]; producerStats: ProducerStats }> {
  const presets = VENDOR_PRESETS[params.vendor]
  const videoModels =
    params.pipeline === 'image' ? [] : buildModelChain(params.model, presets.semanticVideo)
  const snapshotModels = buildModelChain(params.model, presets.semanticSnapshot)

  const semantic = new ActivitySemanticService(params.provider, {
    videoModels,
    snapshotModels,
    pipelinePreference: params.pipeline,
    debugDumper: params.dumper,
    // The default UsageTracker reads Electron's app.getPath, absent under enode.
    usageTracker: { recordUsage: () => {} },
  })
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memorylane-replay-'))
  const transformer = new DefaultActivityTransformer(
    new FfmpegVideoStitcher(),
    params.ocr ? activityOcrService : new StubOcrService(),
    semantic,
    new StubEmbeddingService(),
    { outputDir: tmpDir, getPipelinePreference: () => semantic.getPipelinePreference() },
  )

  try {
    return await replayFixture({
      fixtureDir: params.fixtureDir,
      transformer,
      getLastDiagnostics: () => semantic.getLastRunDiagnostics(),
    })
  } finally {
    semantic.dispose()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}
