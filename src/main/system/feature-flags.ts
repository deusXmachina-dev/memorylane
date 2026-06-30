/**
 * Main-process feature flags.
 *
 * Kept here (not in src/shared) so the renderer bundle never evaluates
 * `process.env`. Flags are read once at startup.
 */

/**
 * Task mining (grounded sightings), in development alongside the existing
 * pattern detector. OFF by default. Enable for a dev session with:
 *
 *   ML_TASK_MINING=1 npm run dev
 *
 * When ON, the TaskMiner runs on the daily schedule INSTEAD of the
 * PatternDetector.
 */
export const TASK_MINING_ENABLED = process.env.ML_TASK_MINING === '1'
