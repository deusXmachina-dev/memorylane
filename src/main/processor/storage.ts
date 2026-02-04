import * as lancedb from '@lancedb/lancedb';
import * as path from 'path';
import { app } from 'electron';
import * as fs from 'fs';

// Need to allow index signature for LanceDB compatibility or cast
export interface StoredEvent extends Record<string, unknown> {
  id: string;
  timestamp: number;
  text: string;
  vector: number[];
}

let dbInstance: lancedb.Connection | null = null;
let tableInstance: lancedb.Table | null = null;
const TABLE_NAME = 'context_events';

/**
 * Gets the path to the LanceDB database directory.
 */
function getDbPath(): string {
  // Check if running in Electron
  if (process.versions.electron) {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'lancedb');
  }
  
  // Fallback for testing/Node environment
  return path.join(process.cwd(), 'temp_lancedb_test');
}

/**
 * Initializes the LanceDB connection and ensures the table exists.
 */
export async function initStorage(): Promise<void> {
  if (dbInstance && tableInstance) return;

  const dbPath = getDbPath();
  
  // Ensure directory exists
  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(dbPath, { recursive: true });
  }

  console.log(`Initializing LanceDB at: ${dbPath}`);
  
  dbInstance = await lancedb.connect(dbPath);
  
  const tableNames = await dbInstance.tableNames();
  
  if (!tableNames.includes(TABLE_NAME)) {
    // Create table with empty initial data to define schema
    // We need at least one record or a schema definition. 
    // LanceDB infers schema from the first batch of data if not explicitly provided.
    // For now, we'll wait until the first addEvent to create the table if strictly necessary,
    // OR we can create it with a dummy row and then delete it, or use schema definition if supported by the JS SDK version.
    
    // In this version of the SDK, implicit creation on first write is common.
    // However, to ensure FTS is set up, we might want to be explicit.
    console.log(`Table '${TABLE_NAME}' does not exist. It will be created on first insertion.`);
  } else {
    tableInstance = await dbInstance.openTable(TABLE_NAME);
  }
}

/**
 * Adds an event to the storage.
 */
export async function addEvent(event: StoredEvent): Promise<void> {
  if (!dbInstance) {
    await initStorage();
  }
  
  if (!dbInstance) throw new Error('Failed to initialize LanceDB connection');

  const data = [event];

  if (!tableInstance) {
    // Check again if table exists (race condition check)
    const tableNames = await dbInstance.tableNames();
    if (tableNames.includes(TABLE_NAME)) {
      tableInstance = await dbInstance.openTable(TABLE_NAME);
      await tableInstance.add(data);
    } else {
      // Create table
      tableInstance = await dbInstance.createTable(TABLE_NAME, data);
      
      // Create FTS index on the 'text' column
      await tableInstance.createIndex('text', {
        config: lancedb.Index.fts(),
        replace: true
      });
      console.log('Created FTS index on "text" column.');
    }
  } else {
    await tableInstance.add(data);
  }
}

/**
 * Retrieves an event by ID (helper for testing/verification).
 */
export async function getEventById(id: string): Promise<StoredEvent | null> {
    if (!tableInstance) return null;
    
    const results = await tableInstance
        .query()
        .where(`id = '${id}'`)
        .limit(1)
        .toArray();
        
    if (results.length === 0) return null;
    
    return results[0] as unknown as StoredEvent;
}

/**
 * Helper to close connection (mostly for testing).
 */
export async function closeStorage(): Promise<void> {
    // LanceDB JS SDK handles connections automatically, but we can clear references
    dbInstance = null;
    tableInstance = null;
}
