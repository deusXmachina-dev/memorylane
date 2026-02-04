import { app, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import * as capture from './main/capture';
import { EventProcessor } from './main/processor/index';
import { EmbeddingService } from './main/processor/embedding';
import { StorageService } from './main/processor/storage';
import * as interactionMonitor from './main/interaction-monitor';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let tray: Tray | null = null;
let processor: EventProcessor | null = null;

// Initialize Processor Services
const embeddingService = new EmbeddingService();
const storageService = new StorageService(StorageService.getDefaultDbPath());
processor = new EventProcessor(embeddingService, storageService);

// Prevent app from quitting when all windows are closed (tray app)
app.on('window-all-closed', () => {
  // Don't quit - this is a tray app
});

const createTray = () => {
  // Try to load custom icon, fall back to default
  const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
  let icon: Electron.NativeImage;

  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      // Use a default icon if custom icon not found
      icon = nativeImage.createEmpty();
    }
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('MemoryLane - Screen Capture');

  updateTrayMenu();

  // Register a callback to process screenshots
  capture.onScreenshot(async (screenshot) => {
    // 1. Log basic info
    console.log(`[Main] Screenshot captured: ${screenshot.id}`);

    // 2. Send to Processor
    if (processor) {
      try {
        await processor.processScreenshot(screenshot);
        console.log(`[Main] Screenshot processed successfully: ${screenshot.id}`);
      } catch (error) {
        console.error(`[Main] Error processing screenshot ${screenshot.id}:`, error);
      }
    }
  });

  // Subscribe to interaction events (independent stream)
  interactionMonitor.onInteraction((event) => {
    const logData: Record<string, unknown> = {
      type: event.type,
      timestamp: new Date(event.timestamp).toISOString(),
    };

    if (event.clickPosition) {
      logData.clickPosition = event.clickPosition;
    }

    if (event.keyCount) {
      logData.keyCount = event.keyCount;
    }

    if (event.durationMs) {
      logData.durationMs = event.durationMs;
    }

    console.log('Interaction event:', logData);
  });
};

const updateTrayMenu = () => {
  if (!tray) return;

  const isCapturing = capture.isCapturingNow();

  const contextMenu = Menu.buildFromTemplate([
    {
      label: isCapturing ? 'Stop Capture' : 'Start Capture',
      click: () => {
        if (isCapturing) {
          capture.stopCapture();
          interactionMonitor.stopInteractionMonitoring();
        } else {
          capture.startCapture();
          // Start interaction monitoring separately
          try {
            interactionMonitor.startInteractionMonitoring();
          } catch (error) {
            console.error('Failed to start interaction monitoring:', error);
            console.log('Continuing without interaction monitoring');
          }
        }
        updateTrayMenu();
      },
    },
    {
      label: 'Capture Now',
      click: async () => {
        try {
          const screenshot = await capture.captureNow();
          console.log('Manual capture successful:', screenshot.id);
        } catch (error) {
          console.error('Manual capture failed:', error);
        }
      },
    },
    {
      label: 'Test Search: "MemoryLane"',
      click: async () => {
        if (!processor) {
          console.error('[Test Search] Processor not initialized');
          return;
        }
        
        try {
          console.log('[Test Search] Starting search for "MemoryLane"...');
          const results = await processor.search('MemoryLane');
          
          console.log('\n=== FTS Results ===');
          results.fts.forEach((event, idx) => {
            console.log(`${idx + 1}. [${event.id}] ${new Date(event.timestamp).toISOString()}`);
            console.log(`   Text: ${event.text.substring(0, 100)}${event.text.length > 100 ? '...' : ''}`);
          });
          
          console.log('\n=== Vector Results ===');
          results.vector.forEach((event, idx) => {
            console.log(`${idx + 1}. [${event.id}] ${new Date(event.timestamp).toISOString()}`);
            console.log(`   Text: ${event.text.substring(0, 100)}${event.text.length > 100 ? '...' : ''}`);
          });
          
          console.log('\n[Test Search] Complete\n');
        } catch (error) {
          console.error('[Test Search] Error:', error);
        }
      },
    },

/*     { type: 'separator' },
    {
      label: `Screenshots: ${capture.getScreenshotsDir()}`,
      enabled: false,
    }, */
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        capture.stopCapture();
        interactionMonitor.stopInteractionMonitoring();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
};

// This method will be called when Electron has finished initialization
app.on('ready', () => {
  createTray();
  console.log('MemoryLane started. Screenshots will be saved to:', capture.getScreenshotsDir());
});

// macOS: Prevent dock icon from showing (optional for tray-only app)
if (process.platform === 'darwin') {
  app.dock?.hide();
}
