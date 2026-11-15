# Recommendation Evaluation

Offline evaluation suite and beyond-accuracy quality gates for `rankCandidates` (`src/services/recommendation/rankCandidates.ts`), implementing the evaluation contract in `docs/recommendation-framework.md` and `cinematch_v1.1.0.md` §5.2.

## Artifacts

- **Evaluation metrics:** `src/services/recommendation/evaluation.ts` (`supply`, `intraListDiversity`, `meanNoveltyPercentile`, `bucketMix`, `nonSeedNeighbourShare`, `popularityHeadShare`).
- **Deterministic fixtures:** `src/services/recommendation/__tests__/fixtures/profiles.ts` (`coldStart`, `casual`, `heavy`, `niche`), built with a seeded Mulberry32 PRNG (`createSeededRng`, no `Math.random`), 180-film pools with log-distributed `vote_count` from `50` to `2,000,000`, mixed `CandidateSource` tags, and titles guaranteed distinct under `getSeriesKey`.
- **Evaluation & regression guard suite:** `src/services/recommendation/__tests__/evaluation.test.ts`, running at `serendipityLevel` `30` and `85` (`size: 30`, plus `size: 40` supply check on `heavy`) and comparing against a naive `vote_count`-sorted baseline.

## Quality Thresholds and Rationale

| Metric | Threshold | Naive `vote_count` baseline (expected) | `rankCandidates` analytical expectation | Why this threshold was chosen |
| --- | --- | --- | --- | --- |
| `supply` (`heavy` profile) | `>= 30` (exact `30` at `size: 30`, `40` at `size: 40`) | `30` | `30` (`40` at `size: 40`) | Guards against the CIN-3 pool-collapse failure mode where heavy raters ran out of unrated candidates (~8 items). |
| `intraListDiversity` | `>= 0.70` | `<= 0.54` | `~0.80–0.89` | Mean pairwise `1 - candidateSimilarity`. Ensures MMR (`λ = 0.7`) and multi-bucket selection prevent franchise/director/genre monoculture while rejecting clustered blockbuster sorting (`~0.51–0.54`). |
| `meanNoveltyPercentile` | `>= 0.35` | `~0.08` | `~0.45–0.70` | Mean inverse midpoint-percentile by `vote_count` within the 180-film pool. Ensures long-tail and mid-tail discovery contributes meaningfully instead of hugging the top-voted head (`~0.08`). |
| `bucketMix` tolerance | `<= 0.06` per bucket (`below_floor === 0`) | Fails (`1.00` safe_bet) | `<= 0.02` (`±1` item at `size: 30`) | Verifies Largest-Remainder allocation honors `mixForSerendipityLevel(30)` (`50/35/15`) and `mixForSerendipityLevel(85)` (`~26/39/35`) within ~1–2 items without leaking `below_floor` items when supply suffices. |
| `nonSeedNeighbourShare` | `>= 0.35` at `serendipityLevel = 30`; `>= 0.50` at `serendipityLevel = 85` | Pool-dependent | `~0.55–0.80` (30), `~0.70–0.90` (85) | Prevents the list from collapsing to TMDB `/similar` and `/recommendations` neighbours alone; requires higher non-seed exploration when serendipity increases. |
| `popularityHeadShare(10, 0.20)` (`niche` profile) | `<= 0.30` | `1.00` (10/10) | `~0.00–0.10` | Guards against global popularity bias (Abdollahpouri et al. 2019): at most 3 of the top 10 recommendations for a niche viewer (60 ratings mostly in `Documentary` and `Music`) may come from the pool's top 20% most-voted films. |

## Measured Values Status

- **Authoring environment note:** Terminal command execution (`vitest`, `tsc`, `eslint`) was unavailable during creation of this suite, so live runner outputs are **pending CI/worker execution**.
- **Analytical verification:** Every metric formula, fixture pool composition (180 items per pool, `N_above >= 129`), bucket supply check (`wildcard >= 20`, `stretch >= 45`, `safe_bet >= 64`), and naive `vote_count` upper bound (`diversity <= 0.54`, `novelty ≈ 0.08`, `popularityHeadShare = 1.00`) was derived directly against `src/services/recommendation/scoring.ts` and `src/services/recommendation/rankCandidates.ts`. Once the worker runs `npm run test`, record the exact observed metrics per profile if any threshold is adjusted.

## Invariants Guarded

- Zero rated films (`userRatings` movie IDs) appear in output, including when rated films exist in the candidate pool (`heavy` includes 5 rated IDs).
- Zero duplicate `movie.id` or `getSeriesKey` entries appear in output.
- Ranks are strictly sequential `1..n`, scores are finite in `0..100`, and `rankCandidates` is deterministic across repeated calls.
- Increasing `serendipityLevel` from `30` to `85` strictly increases `wildcard` share and decreases `safe_bet` share across all four profiles.
