# Recommendation framework

The target architecture for candidate generation and ranking. It serves the north star in `docs/vision.md`: films the user loves but would not have chosen alone. Every loop issue that touches recommendations implements part of this document.

## Diagnosis of the current pipeline

`getCandidateRecommendationPool` in `src/services/tmdb.ts` draws almost every candidate from page 1 of popularity-sorted or acclaim-sorted TMDB queries (`vote_count.gte` 800–1500, weekly trending) plus `/recommendations` and `/similar` for only four seed films. A heavy rater has already seen most of those, so after excluding rated films the pool collapses (CIN-3: about 8 results). The pool is also popularity-biased by construction, which works against surprise. AI providers see only the first 40 candidates; the local provider returns at most 20.

## Research basis

These are well-established results, cited from memory. Verify details before quoting them in user-facing text.

- **Accuracy is not enough** (McNee, Riedl and Konstan 2006; Herlocker et al. 2004): user satisfaction depends on novelty, diversity and serendipity, not only on predicted rating.
- **Serendipity = relevance + novelty + unexpectedness** (Kotkov, Wang and Veijalainen 2016, survey). An unexpected but irrelevant item is just noise.
- **Two-stage design** (Covington, Adams and Sargin 2016, YouTube): broad, multi-source candidate generation, then a precise ranker over a few hundred candidates.
- **Popularity bias** (Abdollahpouri et al. 2019): standard pipelines over-recommend the head; long-tail exposure needs explicit design.
- **Diversification** with Maximal Marginal Relevance (Carbonell and Goldstein 1998) and topic diversification (Ziegler et al. 2005): trade relevance against similarity to items already chosen.
- **Calibration** (Steck 2018): the share of each taste area in the list should reflect the user's history unless the list is deliberately exploring.
- **Exploration versus exploitation** (multi-armed bandits): spend a bounded, adaptive share of slots on exploration and learn from outcomes.

## Stage 1: candidate generation

Target: 300 or more unrated candidates for a heavy rater, each tagged with the sources that produced it. Every source is bounded in requests, pages and concurrency, and every request is cancellable.

| Source | Idea | TMDB access |
| --- | --- | --- |
| Seed graph | Neighbours of loved films. Sample 8–12 seeds weighted by rating and recency, and rotate them between generations so results don't repeat | `/movie/{id}/recommendations`, `/movie/{id}/similar`, pages 1–2 |
| Creator graph | Other films by the directors and writers of loved films. A strong path to surprise across genres | `/movie/{id}/credits`, `/person/{id}/movie_credits` |
| Keyword affinity | Films sharing the user's most characteristic keywords (weighted by rating, down-weighted when common) rather than broad genres | `/discover/movie?with_keywords` |
| Hidden gems | Well-rated, less-seen films in the user's areas: `vote_average` ≥ 7, `vote_count` roughly 50–800 | `/discover/movie` |
| Bridges | Acclaimed films in adjacent genres, countries, languages or eras the user rarely rates | `/discover/movie` with `with_original_language`, dates or genres |
| Acclaimed baseline | Today's popular and top-rated queries, kept as a small share for cold start | existing queries |

Cold start (fewer than about 5 ratings) leans on vibes, eras and the acclaimed baseline, as today.

**Load more:** each source keeps a page cursor. "Show more" pulls the next pages from the sources that are yielding unrated films, instead of regenerating from scratch.

## Stage 2: scoring

For each candidate, scores normalized to 0–1:

- **Relevance r:** affinity with the taste profile (genres, keywords, creators, era) learned from ratings, centered so that low ratings count against. Existing local heuristics are the starting point.
- **Novelty n:** how little-known the film is, from popularity and vote count percentile within the pool.
- **Unexpectedness u:** distance from the user's usual profile (genres, keywords, decade, language) and from what they would find themselves, approximated by not being a direct neighbour of a seed.
- **Serendipity s = r · (0.5 n + 0.5 u)**, only when r is above a relevance floor. Below the floor, a candidate cannot be a stretch or a wildcard.

## Stage 3: list construction

1. **Buckets.** Safe bets (high r), stretches (r above the floor with medium-high s) and wildcards (r above the floor with the highest u). The default mix is about 50 / 35 / 15. The existing serendipity slider shifts it.
2. **Diversity.** Fill each bucket with MMR (λ around 0.7) so the list doesn't turn into ten films by one director or in one sub-genre.
3. **Interleave** buckets so the top of the list always has safe bets and at least one stretch.
4. **Explain.** Every item carries its bucket and a reason. For stretches and wildcards, the reason says why it's worth the risk ("you rate slow-burn thrillers highly; this is one from 1970s Japan").
5. **AI role.** When a cloud AI is selected, it receives a stratified sample (60–80 candidates across buckets and sources, not just the first 40), re-ranks it and writes the reasons. Local scoring remains the fallback and the AI-free mode.

## Stage 4: learning from outcomes

Store each shown recommendation's bucket and sources with its generation, without credentials. When the user later rates a recommended film:

- Record the outcome per bucket and source.
- Adapt the exploration share within bounds (for example 10–30% wildcards): increase it when stretches and wildcards score 8 or more, decrease it when they disappoint.
- Optionally down-weight sources that keep producing disliked films.

## Evaluation

Offline, in CI, with fixed fixture profiles and candidate pools (also required by spec section 5.2):

- **Supply:** a heavy-rater fixture yields at least 30 ranked unrated films.
- **Invariants:** no rated films or duplicates, stable tie ordering, valid ranks.
- **Beyond accuracy:** intra-list diversity, mean novelty (popularity percentile), bucket mix within tolerance, share of non-seed-neighbour items.

Online, the owner's real-world judgment, plus the per-bucket outcomes recorded in Stage 4. Formula tests do not prove recommendation quality.
