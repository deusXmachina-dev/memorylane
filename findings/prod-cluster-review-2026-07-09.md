# Prod cluster review — 2026-07-09 (grounding for DEU-192 naming plan)

Before implementing the DEU-192 naming-consistency change (canonical titles + `subject` column + known-procedures vocabulary), the production sightings/clusters were reviewed to ground it in measured data. v1.4.0-alpha.6 (PR #214) had shipped the clustering rework and prod was re-mined by the 60-day backfill (2026-07-07..09, current prompts).

**Dataset**: 95 sightings over 34 days, 57 clusters (44 singletons, largest 8). Five parallel analysts + 20 adversarial verifications (workflow `wf_90172f2d-688`).

## Verified findings

1. **Core premise confirmed — drift is pure cross-day re-coining.** Title reuse never survives a day boundary: **0/79** cross-day within-cluster pairs share a normalized title (no title ever repeats across days, dataset-wide). **6/21** same-day pairs match, all from one scan run. This is exactly what vocabulary feedback targets. Object-in-title in **21/95** titles (22%); the biggest cluster's 4× "Review MemoryLane Admin Panel for Tenant {CXC|El Jannah|Love To Dream|OrbitRemit}" (one run, 2026-07-08) is the literal DEU-192 symptom. Titles are today the _only_ persisted carrier of the object → `subject` must land with canonicalization or tenant info is lost.

2. **The vocabulary `kind` filter backfires (→ Amendment A).** `kind ∈ {'', 'procedure'}` reduces to procedure-only (all 21 kind-less clusters are unlabeled) → feeds 22 titles of which **14 (64%)** are single-sighting merge-ride-along labels hidden by the UI noise floor, while _excluding_ the top-recurrence, worst-drifting clusters ("Review MemoryLane Tenant Devices" 8×/monitoring, "Draft Security Questionnaire Answers" 5×/judgment). It also violates the code contract (`src/shared/types.ts:284` — `kind` is advisory display metadata, never a filter). **Fix**: `timesSeen >= 2`, no `kind` predicate. Yields ~13 titles on prod — all recurring, all UI-visible.

3. **The "Replace with:" description tail is innocent — keep it.** 81/95 descriptions carry it (~31% of description chars, mandated by `prompts.ts`), and the 0.65 attach threshold was calibrated on tail-bearing text. Counterfactual re-embedding with the app's own model: stripping the tail _worsens_ precision (cross-cluster pairs ≥0.65: 46→55) and recall (within-cluster pairs <0.65: 13→29). No description hygiene, no `CLUSTER_SCHEMA_VERSION` bump — geometry text construction (`title. description`) is unchanged.

4. **Attach geometry is clean; residual defects are semantic.** All members ≥0.807 cosine to their own centroid, none closer to a foreign one. The one contamination class — sightings reviewing the task-miner's own analysis output attach to the described procedure's cluster (3 sightings, 2 clusters, cosines 0.84–0.91) — is a dogfooding artifact of developing MemoryLane on MemoryLane; the existing creative/investigative exclusion is the policy, no special-case prompt bullet.

5. **Duplicate labels are legitimate (→ Amendment B).** Identical titles already land in different clusters ("Reviewing and merging pull requests" ×2, cosine 0.398 — descriptions dominate the embedding), and the PR-review family's centroids (0.20–0.57) sit below the 0.55 merge-candidate bar. Post-canonicalization, permanently un-mergeable clusters will share labels. **Nothing may assume label uniqueness.**

6. **Vocabulary cannot merge; it only prevents future splits.** Shared canonical titles lift same-procedure pairs modestly (~0.5→0.6); consolidating existing fragments is the merge-review's job (the provisioning pair at centroid 0.755 was offered and declined, 30-day ledger). Both fragmentation artifacts die with the blank-sheet reset anyway.

7. **Backfill gets zero vocabulary.** Clusters (hence labels) only exist after the backfill's single final clustering pass, so the 60-day seed corpus drifts exactly like today's DB; convergence starts with post-backfill daily scans. Today's state is the accepted baseline.

8. **`timesSeen` overstates recurrence ~2×** in 4/13 multi-member clusters (several sightings per day for one continuous task; e.g. "2× recurring" = one PR created+merged same day). With `subject`, legitimate same-day multi-sightings become _more_ common. Follow-up (roadmap duration-semantics item), not in the DEU-192 scope.

## What this grounded

- `subject` persistence is **required, not optional**, for the scanOnly=false path (grounding keep-JSON had no subject field, and `run-detection` persists grounding output verbatim).
- Amendment A: `getKnownProcedureTitles` uses `timesSeen >= 2` + no `kind` filter + `label ASC` tie-break (`created_at` is non-unique — one rebuild stamps all clusters with one value).
- Amendment B: duplicate-label tolerance in the review label task; no code assumes label uniqueness.
- "No version bumps" and "keep the description tail" both hold — the blank-sheet reset re-mines everything, so no mixed-era signatures.
- Prompt-structure compliance ceiling is ~83–85% (14–16/95 sightings lack the mandated tail); canonical-title/subject rules will leak similarly — the clustering layer, not the prompt, remains the consistency backstop.
