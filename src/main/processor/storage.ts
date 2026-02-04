import * as lancedb from '@lancedb/lancedb';
import * as path from 'path';
import * as fs from 'fs';
// We use require for electron to avoid aggressive static analysis or issues in Node test env
// where 'electron' module might not behave as expected if imported at top level without checking.
// However, standard import is usually fine if we guard usages.
import { app } from 'electron';

export interface StoredEvent extends Record<string, unknown> {
  id: string;
  timestamp: number;
  text: string;
  vector: number[];
}

export class StorageService {
  private dbPath: string;
  private dbInstance: lancedb.Connection | null = null;
  private tableInstance: lancedb.Table | null = null;
  private readonly TABLE_NAME = 'context_events';

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /**
   * Helper to get the default database path based on environment.
   */
  public static getDefaultDbPath(): string {
    // Check if running in Electron (using process.versions.electron)
    if (process.versions.electron) {
      try {
        const userDataPath = app.getPath('userData');
        return path.join(userDataPath, 'lancedb');
      } catch (e) {
        console.warn('Failed to get Electron userData path, falling back to temp.', e);
      }
    }
    
    // Fallback for testing/Node environment or if app is not ready
    return path.join(process.cwd(), 'temp_lancedb_storage');
  }

  /**
   * Initializes the connection and ensures the directory exists.
   */
  public async init(): Promise<void> {
    if (this.dbInstance) return;

    // Ensure directory exists
    if (!fs.existsSync(this.dbPath)) {
      fs.mkdirSync(this.dbPath, { recursive: true });
    }

    console.log(`Initializing LanceDB at: ${this.dbPath}`);
    this.dbInstance = await lancedb.connect(this.dbPath);
    
    // Check if table exists
    const tableNames = await this.dbInstance.tableNames();
    if (tableNames.includes(this.TABLE_NAME)) {
      this.tableInstance = await this.dbInstance.openTable(this.TABLE_NAME);
    } else {
      console.log(`Table '${this.TABLE_NAME}' does not exist. It will be created on first insertion.`);
    }
  }

  /**
   * Adds an event to the storage.
   */
  public async addEvent(event: StoredEvent): Promise<void> {
    if (!this.dbInstance) {
      await this.init();
    }
    
    if (!this.dbInstance) throw new Error('Failed to initialize LanceDB connection');

    const data = [event];

    if (!this.tableInstance) {
      // Check again if table exists (race condition check)
      const tableNames = await this.dbInstance.tableNames();
      if (tableNames.includes(this.TABLE_NAME)) {
        this.tableInstance = await this.dbInstance.openTable(this.TABLE_NAME);
        await this.tableInstance.add(data);
      } else {
        // Create table
        this.tableInstance = await this.dbInstance.createTable(this.TABLE_NAME, data);
        
        // Create FTS index on the 'text' column
        await this.tableInstance.createIndex('text', {
          config: lancedb.Index.fts(),
          replace: true
        });
        console.log('Created FTS index on "text" column.');
      }
    } else {
      await this.tableInstance.add(data);
    }
  }

  /**
   * Helper to normalize a record's vector to a plain number array.
   */
  private normalizeVector(record: any): StoredEvent {
    let vector: number[] = [];
    if (Array.isArray(record.vector)) {
        vector = record.vector as number[];
    } else if (record.vector && typeof (record.vector as any).toArray === 'function') {
         vector = (record.vector as any).toArray();
    } else if (record.vector) {
        // Fallback for TypedArrays or Arrow Vectors that are iterable
        vector = Array.from(record.vector as Iterable<number>);
    }

    return {
        ...record,
        vector
    } as StoredEvent;
  }

  /**
   * Retrieves an event by ID (helper for testing/verification).
   */
  public async getEventById(id: string): Promise<StoredEvent | null> {
    if (!this.tableInstance) return null;
    
    const results = await this.tableInstance
        .query()
        .where(`id = '${id}'`)
        .limit(1)
        .toArray();
        
    if (results.length === 0) return null;
    
    return this.normalizeVector(results[0]);
  }

  /**
   * Full-text search using FTS index.
   */
  public async searchFTS(query: string, limit = 5): Promise<StoredEvent[]> {
    if (!this.tableInstance) {
      await this.init();
    }
    
    if (!this.tableInstance) return [];

    const results = await this.tableInstance
      .search(query)
      .limit(limit)
      .toArray();

    return results.map(record => this.normalizeVector(record));
  }

  /**
   * Vector similarity search.
   */
  public async searchVectors(queryVector: number[], limit = 5): Promise<StoredEvent[]> {
    if (!this.tableInstance) {
      await this.init();
    }
    
    if (!this.tableInstance) return [];

    const results = await this.tableInstance
      .vectorSearch(queryVector)
      .limit(limit)
      .toArray();

    return results.map(record => this.normalizeVector(record));
  }

  /**
   * Closes the connection (mostly for cleanup/testing).
   */
  public async close(): Promise<void> {
    this.dbInstance = null;
    this.tableInstance = null;
  }
}
