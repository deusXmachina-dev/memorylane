# MemoryLane v1.5.5

Sign-in screens are now skipped, configured LLM timeouts are finally honored, task durations go back to measured time, and the Gemini 2.5 defaults are retired ahead of their shutdown.

## What's Changed

- **Sign-in screens are skipped**: browser sign-in pages, single sign-on and password reset flows, and password manager apps are no longer captured. On by default under Advanced options, and capture resumes by itself once you move on. Matching covers common English pages — a screen in another language, or an unusual one, can still slip through (#271).
- **Configured LLM timeouts now hold**: the HTTP layer capped every request at 5 minutes beneath `fetch()`, below any setting, so a local model still generating was disconnected no matter what you configured. The deadline is now the caller's, with a global backstop above it. Errors also carry the underlying network code, so a stalled local model is distinguishable from a refused connection (#274).
- **Task durations back to measured time**: v1.5.4 bridged gaps up to 5 minutes between a task's activities and counted them as active. On interleaved days the same minute was credited to several tasks at once — 1.68× inflated on a real database, with days claiming more task time than the machine captured all day. Duration is now the plain union of captured activity; the presence heartbeat already keeps read and think time inside it. Existing data is recalculated on upgrade, so averages come back down (#269).
- **Reliable cluster merges**: the review calls served the model raw UUIDs, and one mangled character turned a merge the model proposed into a 30-day suppression of that pair. Review now uses the same short handles the scan has always used (#267).
- **Gemini 2.5 retired from defaults**: Google discontinues Gemini 2.5 on Vertex endpoints on 2026-10-20. Vertex moves to `gemini-3.5-flash-lite` and the OpenRouter chain swaps in GA successors. Remembered model picks are overwritten on upgrade so no install is stranded on a retired id (#265).
- **Explorer plan price**: the activation screen now shows $100/mo (#275).

## Known Issues & Limitations

- Existing per-machine Windows installs (v1.3.x and earlier) are not removed automatically: uninstall MemoryLane from Program Files once (requires admin), then run the new setup.
- Vertex managed-mode bearer tokens aren't refreshed in-flight — long-running operations that outlive the token TTL may see 401s until the next refresh cycle (DEU-84).
- Windows OCR still depends on native OCR component availability.
- Intel macOS is not yet officially supported.

## Installation

- macOS customer (Apple Silicon): install from the GitHub release page.
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately per customer.
- Windows customer: `MemoryLane-Setup.exe` — installs per-user, no admin needed.
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately per customer.

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.4...v1.5.5
