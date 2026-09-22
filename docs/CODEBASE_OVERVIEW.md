# CineMatch AI — Codebase Overview

## Application Overview
CineMatch AI is a client-first, privacy-focused movie recommendation and cinephile taste-profiling application. Built with a Bring-Your-Own-Key (BYOK) architecture and zero hosted backends, the app queries The Movie Database (TMDB) for catalog metadata and scores films using a modular AI engine (Google Gemini, OpenRouter, or an offline Local Smart Heuristic Engine) against a 1–10 user rating scale.

## Principal Code Areas

- **Application Entry & Shell**: `src/main.tsx` initializes the React 19 root, runs storage migrations, triggers Android Keystore credential recovery, and sets native status bar styling. `src/App.tsx` coordinates top-level tab navigation (Calibration, Rankings, Watchlist, Library), handles Android hardware back-button events, and lazily mounts modal dialogs.
- **State & Storage**: `src/store/useMovieStore.tsx` encapsulates central application state for user ratings, watchlists, AI parameters, and recommendation generation. `src/services/storage.ts` manages schema v2 `localStorage` persistence, in-memory fallbacks for quota exceeded errors, and legacy data migration.
- **Credential Security**: `src/services/credentialStore.ts` stores user API keys exclusively in runtime heap memory for web sessions. `src/services/credentialCoordinator.ts` and `src/services/nativeCredentialVault.ts` bridge to encrypted on-device storage on Android.
- **Metadata & Recommendation Engine**: `src/services/tmdb.ts` integrates with the TMDB REST API using a bounded LRU cache for candidate pooling. `src/services/ai/aiManager.ts` manages provider dispatch across `src/services/ai/geminiProvider.ts`, `src/services/ai/openRouterProvider.ts`, and `src/services/ai/localProvider.ts`.
- **UI Components**: Reusable interface elements live in `src/components/`, including `TasteCalibration.tsx`, `RankedFeed.tsx`, `MyRatings.tsx`, `Watchlist.tsx`, and `Navbar.tsx`.
- **Capacitor & Android Native**: `capacitor.config.ts` sets the Capacitor runtime configuration (`com.cinematch.app`). Native Android project files reside in `android/`, including `android/app/build.gradle`, `android/app/src/main/AndroidManifest.xml`, and native plugin sources in `android/app/src/main/java/com/cinematch/app/` (`MainActivity.java`, `CredentialVaultPlugin.java`).

## Verification Commands

The project defines the following quality and verification scripts in `package.json` (also verified in `.github/workflows/ci.yml`):
- `npm run typecheck`: Typechecks TypeScript using `tsc --noEmit`.
- `npm run lint`: Checks code style with ESLint via `eslint .`.
- `npm test`: Executes the Vitest unit and integration test suite (`vitest run`).
- `npm run test:coverage`: Runs the test suite with v8 code coverage reporting.
- `npm run build`: Typechecks and builds the production web bundle (`tsc && vite build`).
- `npm run cap:sync`: Builds the web bundle and syncs assets to Android (`npm run build && npx cap sync`).
