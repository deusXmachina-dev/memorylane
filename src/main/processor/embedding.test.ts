import { describe, it, expect } from 'vitest';
import { EmbeddingService } from './embedding';

describe('EmbeddingService', () => {
  // Increase timeout as model download might take time on first run
  it('should generate an embedding for text', { timeout: 30000 }, async () => {
    const service = new EmbeddingService();
    const text = 'This is a test sentence for embedding.';
    
    const vector = await service.generateEmbedding(text);
    
    expect(vector).toBeDefined();
    // all-MiniLM-L6-v2 outputs 384 dimensions
    expect(vector.length).toBe(384);
    
    // Check if values are numbers and not NaN
    expect(typeof vector[0]).toBe('number');
    expect(isNaN(vector[0])).toBe(false);
  });

  it('should handle empty text', async () => {
    const service = new EmbeddingService();
    const vector = await service.generateEmbedding('');
    
    expect(vector).toBeDefined();
    expect(vector.length).toBe(384);
    // Should be zero vector
    expect(vector.every(v => v === 0)).toBe(true);
  });
});
