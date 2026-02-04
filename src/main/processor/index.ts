import * as fs from 'fs';
import { extractText } from './ocr';
import { EmbeddingService } from './embedding';
import { StorageService, StoredEvent } from './storage';
import { Screenshot } from '../../shared/types';

export class EventProcessor {
  private embeddingService: EmbeddingService;
  private storageService: StorageService;

  constructor(embeddingService: EmbeddingService, storageService: StorageService) {
    this.embeddingService = embeddingService;
    this.storageService = storageService;
  }

  /**
   * Main pipeline: OCR -> Embed -> Store -> Cleanup
   */
  public async processScreenshot(screenshot: Screenshot): Promise<void> {
    const { filepath, id, timestamp } = screenshot;
    
    try {
      console.log(`Processing screenshot: ${id}`);

      // 1. OCR
      // Check if file exists before processing to avoid errors
      if (!fs.existsSync(filepath)) {
          console.warn(`File not found for screenshot ${id}: ${filepath}`);
          return;
      }
      
      const text = await extractText(filepath);
      console.log(`OCR complete for ${id}. Text length: ${text.length}`);

      // 2. Embedding
      // Only generate embedding if there is text, otherwise use zero vector (handled by service)
      const vector = await this.embeddingService.generateEmbedding(text);
      console.log(`Embedding generated for ${id}.`);

      // 3. Store
      const event: StoredEvent = {
        id,
        timestamp,
        text,
        vector
      };
      
      await this.storageService.addEvent(event);
      console.log(`Event stored for ${id}.`);

      // 4. Cleanup
      // Delete the original file to save space and respect privacy
      fs.unlinkSync(filepath);
      console.log(`Deleted temporary file: ${filepath}`);
      
    } catch (error) {
      console.error(`Error processing screenshot ${id}:`, error);
      // We don't delete the file on error so it can be inspected or retried manually if needed
      throw error;
    }
  }

  /**
   * Search for events using both vector similarity and FTS.
   */
  public async search(query: string): Promise<{ fts: StoredEvent[], vector: StoredEvent[] }> {
    console.log(`[Search] Query: "${query}"`);

    // 1. Generate embedding for vector search
    const queryVector = await this.embeddingService.generateEmbedding(query);

    // 2. Vector search
    const vectorResults = await this.storageService.searchVectors(queryVector, 5);
    console.log(`[Search] Vector results: ${vectorResults.length}`);

    // 3. FTS search
    const ftsResults = await this.storageService.searchFTS(query, 5);
    console.log(`[Search] FTS results: ${ftsResults.length}`);

    return { fts: ftsResults, vector: vectorResults };
  }
}
