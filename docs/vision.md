# CineMatch vision

Owner-approved direction for the agent loop. The Coordinator reads this first; the owner changes it through `owner-directive` issues.

## North star

**Recommend a film you love after watching it, and would not have chosen on your own.**

Accuracy alone is not the goal. The app has to beat the user's own picking: a pick they would already have made has little value, and a surprise they didn't enjoy costs trust. Success is surprise that pays off.

## Who it is for

- **Heavy raters:** cinephiles with hundreds of ratings, often imported from Letterboxd or IMDb, who have already seen the obvious picks. They need depth: a long ranked list, the long tail, and films from outside their usual corners.
- **Casual watchers:** want a good answer tonight with little effort. They need a fast start (a few ratings, vibes, eras) and a short list they trust.

One product serves both. Depth is there when you scroll; a confident top few are always there.

## How it should feel

A calm companion, not an AI gadget. Comforting, warm and premium:

- Posters and films are the hero, not the interface. No glowing borders, neon gradients or heavy shadows.
- Quiet confidence: few colors, generous spacing, readable type, gentle motion.
- Every recommendation says why, in plain language, including why a surprise is worth the risk.
- Honest: it says when it is exploring ("a stretch for you") versus playing safe.

## Product pillars, in priority order

1. **A ranking worth trusting.** Enough candidates that a heavy rater never runs dry, ranked with a deliberate mix of safe bets, stretches and wildcards. See `docs/recommendation-framework.md`.
2. **Learns from outcomes.** When you rate something it recommended, that tells it whether its surprises are working, and it adjusts how far it explores.
3. **Comforting, premium UI.** As described above.
4. **Private and yours.** BYOK, on-device data, import and export. No backend.
5. **Great on Android.** Native-feeling launch, insets, back behavior.

## Not now

Accounts, social features, a backend or proxy, monetization, streaming-availability integrations.

## First loop milestone (M1)

Fix the number and quality of ranked recommendations: a research-based candidate and serendipity framework, a list that grows on demand (CIN-3), and recommendations that explain their surprise. UI and Android polish follow in later milestones.
