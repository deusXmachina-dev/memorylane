# MemoryLane Architecture Diagram

This diagram captures:

- **Current pipeline** (what runs today)
- **Target timeline-first pipeline** (based on your design direction)

## Current (Today)

```mermaid
flowchart TD
  subgraph CaptureAndEvents["Capture + Event Layer"]
    IM["Interaction Monitor<br/>(uiohook + app-watcher)"]
    AM["Activity Manager<br/>(window boundaries + capture triggers)"]
    REC["Recorder<br/>(desktopCapturer + visual detector)"]
    SF["Screenshot Files"]
  end

  subgraph Processing["Processing Layer"]
    PQ["Processing Queue"]
    AP["Activity Processor"]
    OCR["OCR"]
    CLS["Semantic Classifier (LLM)"]
    EMB["Embedding Service"]
    DB["Storage (SQLite + vec + FTS)"]
  end

  IM --> AM
  AM -->|captureImmediate / captureIfVisualChange / captureWindowByTitle| REC
  REC --> SF
  AM -->|completed activity with screenshots + interactions| PQ
  PQ --> AP
  AP --> OCR
  AP --> CLS
  AP --> EMB
  AP --> DB
```

## Target (Timeline-First)

```mermaid
flowchart TD
  subgraph Producers["Independent Producers"]
    SP["Screen Capturer<br/>(fixed interval, e.g. 1 fps)"]
    EP["Event Capturer<br/>(interaction + app/window events)"]
  end

  subgraph Streams["Durable Streams"]
    FS["Frame Stream"]
    ES["Event Stream"]
  end

  subgraph Activity["Activity Layer"]
    APROD["Activity Producer<br/>(sessionize + join frames/events + build activity payload)"]
    AOUT["Activity Stream"]
  end

  subgraph Extraction["LLM/OCR/Embedding Layer"]
    EXT["Activity Extraction<br/>(LLM summary + OCR + embeddings)"]
  end

  STORE["Storage"]

  SP --> FS
  EP --> ES
  FS --> APROD
  ES --> APROD
  APROD --> AOUT
  AOUT --> EXT
  EXT --> STORE
```

## Why the target split helps

- Producers are simple and testable in isolation.
- Activity logic is centralized in one producer, which is easier to reason about.
- Activity extraction is downstream-only and independent of capture/sessionization internals.
- Regression tests can replay streams deterministically.
