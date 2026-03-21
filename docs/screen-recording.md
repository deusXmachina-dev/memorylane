# Screen Recording

## Goal

Keep screen recording intentionally small:

- click once to start
- click once to stop
- save an MP4 to the user's video folder

## High-Level Components

1. Main window UI
   - shows the start/stop button
   - calls the main process over IPC

2. `ScreenRecordingService`
   - owns the recording state machine
   - coordinates the hidden recorder window and the output file

3. `ScreenRecordingRecorderWindow`
   - owns the hidden Electron window used only for `getDisplayMedia` and `MediaRecorder`
   - selects the primary display for capture

4. `ScreenRecordingOutput`
   - owns the temporary WebM file
   - appends chunks
   - converts the finished recording to MP4

5. Recorder renderer
   - asks Chromium for display and microphone streams
   - feeds chunks back to the main process

## Flow

1. UI calls `startScreenRecording`.
2. `ScreenRecordingService` creates a `ScreenRecordingOutput`.
3. `ScreenRecordingRecorderWindow` loads the hidden recorder page.
4. The recorder renderer starts `MediaRecorder`.
5. Chunks are streamed back to `ScreenRecordingOutput`.
6. UI calls `stopScreenRecording`.
7. The renderer stops `MediaRecorder`.
8. `ScreenRecordingOutput` finalizes the temp file and converts it to MP4.

## Design Rules

- Keep BrowserWindow management out of the UI layer.
- Keep file writing/transcoding out of the recorder renderer.
- Keep Electron IPC channel names shared in one place.
- Prefer small objects with one obvious job over one large feature file.
