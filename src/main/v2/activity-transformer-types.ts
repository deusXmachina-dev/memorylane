import type { V2Activity } from './activity-types'

export interface ActivityVideoFrameInput {
  filepath: string
  timestamp: number
}

export interface ActivityVideoAsset {
  videoPath: string
  frameCount: number
  durationMs: number
}

export interface ActivityVideoStitcher {
  stitch(input: {
    activityId: string
    frames: ActivityVideoFrameInput[]
    outputPath: string
  }): Promise<ActivityVideoAsset>
}

export interface ActivityOcrService {
  extractText(imagePath: string): Promise<string>
}

export interface ActivitySemanticService {
  summarizeFromVideo(input: {
    activity: V2Activity
    videoPath?: string
    ocrText: string
  }): Promise<string>
}

export interface ActivityEmbeddingService {
  embed(text: string): Promise<number[]>
}
