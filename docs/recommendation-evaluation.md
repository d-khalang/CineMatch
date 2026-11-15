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
| `intraListDiversity` | `>= 0.80` | `0.53–0.54` | `0.89–0.93` | Mean pairwise `1 - candidateSimilarity`. Ensures MMR (`λ = 0.7`) and multi-bucket selection prevent franchise/director/genre monoculture while rejecting clustered blockbuster sorting (`~0.51–0.54`). |
| `meanNoveltyPercentile` | `>= 0.45` | `0.08` | `0.57–0.76` | Mean inverse midpoint-percentile by `vote_count` within the 180-film pool. Ensures long-tail and mid-tail discovery contributes meaningfully instead of hugging the top-voted head (`~0.08`). |
| `bucketMix` tolerance | `<= 0.06` per bucket (`below_floor === 0`) | Fails (`1.00` safe_bet) | `<= 0.02` (`±1` item at `size: 30`) | Verifies Largest-Remainder allocation honors `mixForSerendipityLevel(30)` (`50/35/15`) and `mixForSerendipityLevel(85)` (`~26/39/35`) within ~1–2 items without leaking `below_floor` items when supply suffices. |
| `nonSeedNeighbourShare` | `>= 0.35` at `serendipityLevel = 30`; `>= 0.50` at `serendipityLevel = 85` | Pool-dependent | `0.60–0.77` (30), `0.80–0.90` (85) | Prevents the list from collapsing to TMDB `/similar` and `/recommendations` neighbours alone; requires higher non-seed exploration when serendipity increases. |
| `popularityHeadShare(10, 0.20)` (`niche` profile) | `<= 0.30` | `1.00` (10/10) | `~0.00–0.10` | Guards against global popularity bias (Abdollahpouri et al. 2019): at most 3 of the top 10 recommendations for a niche viewer (60 ratings mostly in `Documentary` and `Music`) may come from the pool's top 20% most-voted films. |

## Measured Values

Measured by the Coordinator on 2026-11-15 with `rankCandidates` as of CIN-9 (the PR's base, before the creator graph #120 and the penalty fix #121; the fame penalty can lower the heavy profile's numbers at serendipity 85, and CI on the merged branch checks the thresholds still hold). The worker could not run commands, so the first draft held estimates; the table above now shows these observed values, and the diversity and novelty thresholds were raised from 0.70 and 0.35 to sit about halfway between the naive ranker and the pipeline.

| Profile | Serendipity | Supply | Diversity | Novelty | Mix safe/stretch/wild/below | Non-seed share | Niche top-10 head |
|---|---|---|---|---|---|---|---|
| cold_start | 30 | 30 | 0.90 | 0.57 | 0.50/0.37/0.13/0.00 | 0.67 | 0.10 |
| cold_start | 85 | 30 | 0.92 | 0.67 | 0.27/0.40/0.33/0.00 | 0.87 | 0.00 |
| casual | 30 | 30 | 0.91 | 0.59 | 0.50/0.37/0.13/0.00 | 0.77 | 0.00 |
| casual | 85 | 30 | 0.93 | 0.71 | 0.27/0.40/0.33/0.00 | 0.90 | 0.00 |
| heavy | 30 | 30 | 0.92 | 0.57 | 0.50/0.37/0.13/0.00 | 0.60 | 0.00 |
| heavy | 85 | 30 | 0.93 | 0.70 | 0.27/0.40/0.33/0.00 | 0.80 | 0.00 |
| niche | 30 | 30 | 0.89 | 0.63 | 0.50/0.37/0.13/0.00 | 0.63 | 0.00 |
| niche | 85 | 30 | 0.92 | 0.76 | 0.27/0.40/0.33/0.00 | 0.87 | 0.00 |

Naive `vote_count` ranker on the same pools: diversity 0.53–0.54, novelty 0.08, popularity-head share 1.00.

**Caveat:** the fixtures give every candidate a director and keywords. In the app, candidates carry only genres until CIN-22 enriches the shortlist, so real diversity may be lower than measured here.

## Invariants Guarded

- Zero rated films (`userRatings` movie IDs) appear in output, including when rated films exist in the candidate pool (`heavy` includes 5 rated IDs).
- Zero duplicate `movie.id` or `getSeriesKey` entries appear in output.
- Ranks are strictly sequential `1..n`, scores are finite in `0..100`, and `rankCandidates` is deterministic across repeated calls.
- Increasing `serendipityLevel` from `30` to `85` strictly increases `wildcard` share and decreases `safe_bet` share across all four profiles.
