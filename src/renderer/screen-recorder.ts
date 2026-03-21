import type {
  ScreenRecorderAPI,
  ScreenRecorderFinishedPayload,
  ScreenRecorderStartOptions,
  ScreenRecorderStartedPayload,
} from '@types'

type ScreenRecorderWindow = Window & {
  screenRecorderAPI?: ScreenRecorderAPI
}

const screenRecorderAPI = (window as ScreenRecorderWindow).screenRecorderAPI

if (!screenRecorderAPI) {
  throw new Error('screenRecorderAPI not available')
}

interface RecorderSession {
  mediaRecorder: MediaRecorder
  displayStream: MediaStream
  microphoneStream: MediaStream | null
  chunkWriteChain: Promise<void>
  finishing: boolean
}

let currentSession: RecorderSession | null = null

screenRecorderAPI.onStartRequested((options) => {
  void startRecording(options)
})

screenRecorderAPI.onStopRequested(() => {
  void stopRecording()
})

async function startRecording(options: ScreenRecorderStartOptions): Promise<void> {
  if (currentSession) {
    return
  }

  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: 30,
      },
      audio: false,
    })

    let microphoneStream: MediaStream | null = null
    if (options.includeMicrophone) {
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      })
    }

    const recordingStream = new MediaStream([
      ...displayStream.getVideoTracks(),
      ...((microphoneStream?.getAudioTracks() ?? []) as MediaStreamTrack[]),
    ])

    const mimeType = getPreferredMimeType()
    const mediaRecorder = mimeType
      ? new MediaRecorder(recordingStream, { mimeType })
      : new MediaRecorder(recordingStream)

    currentSession = {
      mediaRecorder,
      displayStream,
      microphoneStream,
      chunkWriteChain: Promise.resolve(),
      finishing: false,
    }
    attachMediaRecorderEvents(currentSession)

    mediaRecorder.start(1000)

    await screenRecorderAPI.reportStarted({
      mimeType: currentSession.mediaRecorder.mimeType || mimeType || 'video/webm',
    } satisfies ScreenRecorderStartedPayload)
  } catch (error) {
    await failRecording(getErrorMessage(error))
  }
}

async function stopRecording(): Promise<void> {
  const session = currentSession
  if (!session) {
    return
  }

  if (session.mediaRecorder.state !== 'inactive') {
    session.mediaRecorder.stop()
    return
  }

  await finalizeRecording(session)
}

async function finalizeRecording(session: RecorderSession): Promise<void> {
  if (session.finishing) {
    return
  }

  session.finishing = true

  try {
    await session.chunkWriteChain
    await screenRecorderAPI.reportFinished({
      mimeType: session.mediaRecorder.mimeType || 'video/webm',
    } satisfies ScreenRecorderFinishedPayload)
  } catch (error) {
    await screenRecorderAPI.reportError(getErrorMessage(error))
  } finally {
    cleanupSession(session)
  }
}

async function failRecording(message: string): Promise<void> {
  if (currentSession) {
    cleanupSession(currentSession)
  }
  await screenRecorderAPI.reportError(message)
}

function attachMediaRecorderEvents(session: RecorderSession): void {
  session.displayStream.getVideoTracks().forEach((track) => {
    track.addEventListener('ended', () => {
      void stopRecording()
    })
  })

  session.mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data.size === 0) {
      return
    }

    session.chunkWriteChain = session.chunkWriteChain.then(async () => {
      const buffer = new Uint8Array(await event.data.arrayBuffer())
      await screenRecorderAPI.writeChunk(buffer)
    })
  })

  session.mediaRecorder.addEventListener('stop', () => {
    void finalizeRecording(session)
  })

  session.mediaRecorder.addEventListener('error', () => {
    void failRecording('Screen recorder failed')
  })
}

function cleanupSession(session: RecorderSession): void {
  for (const track of session.displayStream.getTracks()) {
    track.stop()
  }
  for (const track of session.microphoneStream?.getTracks() ?? []) {
    track.stop()
  }

  if (currentSession === session) {
    currentSession = null
  }
}

function getPreferredMimeType(): string | null {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
