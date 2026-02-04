import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StorageService, StoredEvent } from './storage';
import * as path from 'path';
import * as fs from 'fs';

// Helper to delete directory recursively
const deleteFolderRecursive = (directoryPath: string) => {
  if (fs.existsSync(directoryPath)) {
    fs.readdirSync(directoryPath).forEach((file) => {
      const curPath = path.join(directoryPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        deleteFolderRecursive(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(directoryPath);
  }
};

describe('StorageService', () => {
  const TEST_DB_PATH = path.join(process.cwd(), 'temp_test_lancedb');
  let storage: StorageService;

  beforeEach(async () => {
    // Clean up before each test
    deleteFolderRecursive(TEST_DB_PATH);
    storage = new StorageService(TEST_DB_PATH);
    await storage.init();
  });

  afterEach(async () => {
    await storage.close();
    deleteFolderRecursive(TEST_DB_PATH);
  });

  it('should initialize without errors', async () => {
    expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
  });

  it('should add and retrieve an event', async () => {
    const event: StoredEvent = {
      id: 'uuid-1',
      timestamp: 1234567890,
      text: 'Hello World',
      vector: [0.1, 0.2, 0.3],
    };

    await storage.addEvent(event);

    const retrieved = await storage.getEventById('uuid-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.text).toBe('Hello World');
    
    // Check vector values with closeTo for floating point comparison
    expect(retrieved?.vector).toBeDefined();
    expect(retrieved?.vector.length).toBe(3);
    expect(retrieved?.vector[0]).toBeCloseTo(0.1);
    expect(retrieved?.vector[1]).toBeCloseTo(0.2);
    expect(retrieved?.vector[2]).toBeCloseTo(0.3);
  });

  it('should handle FTS index creation silently', async () => {
    // This test implicitly checks if FTS creation throws any error
    // In a real scenario, we might query using FTS, but for now we just check if insertion works.
    const event1: StoredEvent = {
      id: 'uuid-fts-1',
      timestamp: 100,
      text: 'Apple Pie',
      vector: [1],
    };

    await storage.addEvent(event1);
    
    // Adding a second event should use the existing table and index
    const event2: StoredEvent = {
      id: 'uuid-fts-2',
      timestamp: 101,
      text: 'Banana Bread',
      vector: [1],
    };
    
    await storage.addEvent(event2);

    const r1 = await storage.getEventById('uuid-fts-1');
    const r2 = await storage.getEventById('uuid-fts-2');
    
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
  });
});
