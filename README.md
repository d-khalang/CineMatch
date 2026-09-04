# CineMatch AI — Technical Architecture & Documentation

CineMatch AI is an AI-first movie recommendation and ranking application built with **React**, **TypeScript**, **Vite**, and **Tailwind CSS**. It combines real-time movie metadata from **The Movie Database (TMDB)** with a **Modular AI Service Architecture** (Google Gemini, OpenRouter, and Local Heuristic Engine) to synthesize personalized, ranked recommendations based on a 1–10 rating scale.

---

## 1. System Architecture & Data Flow

```mermaid
flowchart TD
    subgraph Client [Browser / Client Layer]
        UI[React UI: Taste Calibration / Feed / Modals]
        Store[(LocalStorage Persistence)]
    end

    subgraph TMDB_Layer [TMDB API Service]
        TMDB_API[TMDB REST API v3]
        Cache[In-Memory Request Cache]
        Pooler[Candidate Pool Generator]
    end

    subgraph AI_Layer [AI Service Layer (Adapter Pattern)]
        Manager[AIServiceManager]
        Gemini[Gemini Provider (2.5 / 2.0 / 1.5 Flash)]
        OpenRouter[OpenRouter Provider]
        Local[Local Heuristic / Vector Engine]
    end

    UI -->|1. User Rates 1-10| Store
    UI -->|2. Request Recommendations| Pooler
    Pooler -->|3. Fetch Seeds, Trending & Top Critiques| TMDB_API
    Pooler -->|4. Unrated Candidates Pool (30-40 films)| Manager
    Store -->|5. User Taste Profile Vector| Manager
    Manager -->|6. Dispatch Prompt| Gemini
    Manager -->|6b. Dispatch Prompt| OpenRouter
    Manager -->|6c. Fallback / Zero-Key| Local
    Gemini -->|7. Structured JSON Rankings + Justifications| UI
    OpenRouter -->|7. Structured JSON Rankings + Justifications| UI
    Local -->|7. Multi-Factor Scored Rankings| UI
```

---

## 2. Data Storage & Persistence (Where & What is Saved)

All application data is persisted client-side in the browser's **`localStorage`**. No external database or backend server is required to test or run the app.

### Storage Keys & Data Schemas

#### A. User Ratings (`cinematch_user_ratings_v1`)
Stores all movies rated by the user (keyed by TMDB Movie ID).
```typescript
Record<number, {
  movieId: number;          // e.g. 27205
  title: string;            // e.g. "Inception"
  rating: number;           // Integer 1 to 10
  posterPath: string | null;// e.g. "/x270mI37v4.jpg"
  year?: string;            // e.g. "2010"
  genres: string[];         // e.g. ["Action", "Sci-Fi", "Adventure"]
  director?: string;        // e.g. "Christopher Nolan"
  keywords?: string[];      // e.g. ["dream", "subconscious", "heist"]
  ratedAt: number;          // Unix timestamp (ms)
}>
```

#### B. AI & Discovery Settings (`cinematch_ai_settings_v1`)
Stores the user's active AI provider, API keys, selected models, and preference filters.
```typescript
{
  activeProvider: "gemini" | "openrouter" | "local";
  geminiApiKey: string;        // Encrypted/stored locally only
  geminiModel: string;         // e.g. "gemini-2.5-flash"
  openRouterApiKey: string;
  openRouterModel: string;     // e.g. "deepseek/deepseek-r1:free"
  serendipityLevel: number;    // 0 (Safe Bets) to 100 (Wildcard Exploration)
  selectedVibes: string[];     // e.g. ["Mind-bending", "Slow-burn"]
  preferredEras: string[];     // e.g. ["90s", "2010s"]
}
```

#### C. Watchlist (`cinematch_watchlist_v1`)
Array of bookmarked TMDB movie IDs: `number[]`.

---

## 3. Communication with AI (Request & Response Payloads)

### A. When is AI Called?
1. **On-Demand:** When the user clicks **"Re-Rank with AI"** or **"View Your Ranked List"**.
2. **Tab Switch:** When navigating to the *Top Ranked* tab if no recommendations exist for current ratings.
3. **Parameter Shift:** When adjusting the Serendipity slider or Vibe filters and requesting a refresh.
4. **Test Connection:** When clicking "Test Connection" in Settings (sends a minimal 1-token test payload).

*(Note: AI is **never** invoked on every rating click to keep the UI instant and conserve free API limits).*

---

### B. What Information is Sent to the AI? (Prompt Shape)

The app formats the user's ratings and the candidate pool into a compact structured prompt sent via HTTP `POST` to the Google Gemini API endpoint:
`https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={API_KEY}`

#### Example Request Payload:
```json
{
  "contents": [
    {
      "parts": [
        {
          "text": "You are Cinephile AI, an expert cinematic curator...\n\nUser Profile:\n[\n  {\n    \"title\": \"Arrival\",\n    \"user_rating\": \"10/10\",\n    \"genres\": [\"Drama\", \"Sci-Fi\", \"Mystery\"],\n    \"director\": \"Denis Villeneuve\",\n    \"year\": \"2016\"\n  },\n  {\n    \"title\": \"Sicario\",\n    \"user_rating\": \"9/10\",\n    \"genres\": [\"Action\", \"Crime\", \"Thriller\"],\n    \"director\": \"Denis Villeneuve\",\n    \"year\": \"2015\"\n  },\n  {\n    \"title\": \"Ant-Man\",\n    \"user_rating\": \"3/10\",\n    \"genres\": [\"Action\", \"Comedy\"],\n    \"director\": \"Peyton Reed\",\n    \"year\": \"2015\"\n  }\n]\n\nSerendipity Setting: 75% (Hidden Gems: Branching outside usual comfort zones with high-quality under-the-radar cinema)\nUser Vibe Filters: Mind-bending, High Tension\nUser Era Preferences: Any\n\nCandidate Pool:\n[\n  {\n    \"id\": 335984,\n    \"title\": \"Blade Runner 2049\",\n    \"year\": \"2017\",\n    \"genres\": [\"Sci-Fi\", \"Drama\"],\n    \"tmdb_rating\": 7.6,\n    \"overview\": \"Thirty years after the events of the first film, a new blade runner...\"\n  },\n  {\n    \"id\": 77,\n    \"title\": \"Memento\",\n    \"year\": \"2000\",\n    \"genres\": [\"Mystery\", \"Thriller\"],\n    \"tmdb_rating\": 8.2,\n    \"overview\": \"A man with short-term memory loss attempts to track down his wife's murderer...\"\n  }\n]\n\nInstructions:\n1. Select and rank the best 15-20 films in order of personalized recommendation.\n2. Output strictly valid JSON matching the schema."
        }
      ]
    }
  ],
  "generationConfig": {
    "responseMimeType": "application/json",
    "temperature": 0.7
  }
}
```

---

### C. What Information is Received from the AI? (Response Shape)

The AI responds with a clean JSON object containing ranked candidate IDs, match scores, custom cinephile reasoning, serendipity badges, and highlight tags:

```json
{
  "rankings": [
    {
      "id": 335984,
      "score": 98,
      "reason": "Denis Villeneuve's meditative sci-fi atmosphere directly echoes your 10/10 rating for Arrival, featuring high-tension sound design and existential pacing.",
      "serendipityType": "director_match",
      "highlightTags": ["Denis Villeneuve", "Philosophical Sci-Fi", "Atmospheric"]
    },
    {
      "id": 77,
      "score": 93,
      "reason": "Intricate nonlinear mystery with intense psychological tension, matching your love for cerebral, high-stakes narratives.",
      "serendipityType": "thematic_gem",
      "highlightTags": ["Mind-Bending", "Neo-Noir", "Psychological"]
    }
  ]
}
```

---

## 4. TMDB Candidate Pooling & Algorithm Mechanics

Before calling the AI, the app constructs a relevant candidate pool:
1. **Seed Extraction:** Extracts the user's top-rated films ($\ge 7/10$).
2. **TMDB Graph Queries:** Fetches `/movie/{id}/recommendations` and `/movie/{id}/similar` for those seeds.
3. **Discovery Queries:** Queries `/discover/movie` sorted by `vote_average` and `popularity` with high vote-count thresholds ($\ge 800$ votes).
4. **Deduplication & Filter:** Excludes all films the user has already rated or marked as seen.
5. **Candidate Batch:** Limits the candidate pool to the top 30–40 high-signal candidates for the AI to rank.

---

## 5. Local Heuristic Engine (Zero-Config Fallback)

If no API key is provided or network limits are exceeded, the app automatically runs the **`LocalProvider`** client-side engine:

$$\text{Score}(M) = 50 + \sum_{g} w_g \cdot \text{GenreAffinity}(g) + 20 \cdot \text{DirectorAffinity}(d) + (\text{TMDB Rating} - 6.5) \cdot 4 + E_{\text{serendipity}} - P_{\text{negative}}$$

* **Negative Suppression ($P_{\text{negative}}$):** Movies rated $\le 3/10$ heavily penalize their associated genres and directors.
* **Serendipity Boost ($E_{\text{serendipity}}$):** When the serendipity slider is turned up, highly-rated critically acclaimed films in genres outside the user's primary comfort zone receive discovery score boosts.

---

## 6. Project Structure

```
movie-recom/
├── src/
│   ├── components/
│   │   ├── DiscoveryFilters.tsx     # Serendipity dial & Vibe chips
│   │   ├── MovieDetailsModal.tsx    # Trailers, cast, keywords & metadata
│   │   ├── MyRatings.tsx            # Ratings manager & taste analytics
│   │   ├── Navbar.tsx               # Desktop header & AI status
│   │   ├── MobileBottomNav.tsx      # Mobile bottom tab-bar
│   │   ├── RankedFeed.tsx           # Ranked recommendation list (#1..#N)
│   │   ├── RatingControl.tsx        # 1-10 interactive rating strip
│   │   ├── SettingsModal.tsx        # AI Provider & model configuration
│   │   ├── TasteCalibration.tsx     # Iconic films onboarding grid
│   │   └── CsvImportModal.tsx       # IMDb/Letterboxd CSV importer
│   ├── services/
│   │   ├── ai/
│   │   │   ├── types.ts             # IAIProvider interface
│   │   │   ├── aiManager.ts         # Service factory & fallback manager
│   │   │   ├── geminiProvider.ts    # Google Gemini 2.5 / 2.0 / 1.5 adapter
│   │   │   ├── openRouterProvider.ts# OpenRouter adapter
│   │   │   └── localProvider.ts     # Client-side heuristic vector engine
│   │   └── tmdb.ts                  # TMDB client, caching, endpoints
│   ├── store/
│   │   └── useMovieStore.tsx        # React Context & LocalStorage store
│   ├── types/
│   │   └── index.ts                 # Central TypeScript interfaces
│   ├── App.tsx                      # App router & layout
│   ├── main.tsx                     # Entry point
│   └── index.css                    # Tailwind CSS v4 styling & animations
├── index.html                       # HTML5 template with mobile meta tags
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 7. Future Mobile Deployment (Capacitor)

The codebase is built touch-first with standard mobile touch targets, safe area insets, and bottom navigation. To convert this web application into a native **iOS** or **Android** app:

```bash
# 1. Build the production web bundle
npm run build

# 2. Add Capacitor
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init "CineMatch AI" "com.cinematch.app" --web-dir dist

# 3. Add platforms and sync
npx cap add android
npx cap add ios
npx cap sync

# 4. Open in Android Studio or Xcode
npx cap open android
npx cap open ios
```
