import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GroqProvider,
  GROQ_DEFAULT_MODEL,
  sanitizeGroqModel,
  fetchGroqModels,
} from '../groqProvider';
import { aiManager } from '../aiManager';

const CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS_URL = 'https://api.groq.com/openai/v1/models';
const KEY = 'test_groq_key_xyz';

const pool = [
  {
    id: 1,
    title: 'Inception',
    overview: 'A mind-bending heist.',
    release_date: '2010-07-16',
    vote_average: 8.4,
    vote_count: 35000,
    poster_path: null,
    backdrop_path: null,
    genres: [{ id: 878, name: 'Sci-Fi' }],
  },
];

const ratings = [
  {
    movieId: 99,
    title: 'Interstellar',
    rating: 10,
    posterPath: null,
    genres: ['Sci-Fi'],
    ratedAt: 1,
  },
];

const request = (overrides = {}) =>
  ({
    userRatings: ratings,
    candidatePool: pool,
    serendipityLevel: 30,
    selectedVibes: [],
    preferredEras: [],
    apiKey: KEY,
    ...overrides,
  }) as never;

const validContent = JSON.stringify({
  taste_analysis: 'Likes big ideas.',
  pool_rankings: [
    { id: 1, score: 90, reason: 'Same scale of ideas', serendipityType: 'safe_bet', highlightTags: ['Sci-Fi'] },
  ],
  unconstrained_discoveries: [],
});

const okChat = (content: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
});

const apiError = (status: number, message: string) => ({
  ok: false,
  status,
  statusText: 'Error',
  json: async () => ({ error: { message } }),
});

describe('GroqProvider (frozen)', () => {
  const provider = new GroqProvider();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has the id "groq" and is registered in aiManager', () => {
    expect(provider.id).toBe('groq');
    expect(aiManager.getProvider('groq').id).toBe('groq');
  });

  describe('testConnection', () => {
    it('rejects an empty or whitespace key without calling the network', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      expect((await provider.testConnection('')).success).toBe(false);
      const blank = await provider.testConnection('   ');
      expect(blank.success).toBe(false);
      expect(blank.message).toContain('API key is required');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends the trimmed key as a Bearer header, never in the URL, with the chosen model', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okChat('{"status":"CONNECTED"}'));
      vi.stubGlobal('fetch', fetchMock);

      const result = await provider.testConnection(`  ${KEY}  `, 'some-model');

      expect(result.success).toBe(true);
      expect(result.message).toContain('some-model');
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(CHAT_URL);
      expect(url).not.toContain(KEY);
      expect(options.headers.Authorization).toBe(`Bearer ${KEY}`);
      expect(JSON.parse(options.body).model).toBe('some-model');
    });

    it('uses GROQ_DEFAULT_MODEL when no model is given', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okChat('{"status":"CONNECTED"}'));
      vi.stubGlobal('fetch', fetchMock);

      await provider.testConnection(KEY);

      expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe(GROQ_DEFAULT_MODEL);
    });

    it('reports the API error message on failure, without the key', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(apiError(401, 'Invalid API Key')));

      const result = await provider.testConnection(KEY);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid API Key');
      expect(result.message).not.toContain(KEY);
    });
  });

  describe('generateRecommendations', () => {
    it('rejects a missing key', async () => {
      await expect(
        provider.generateRecommendations(request({ apiKey: '  ' }))
      ).rejects.toThrow('API key is required');
    });

    it('calls Groq with the chosen model and the shared recommendation prompt', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okChat(validContent));
      vi.stubGlobal('fetch', fetchMock);

      const result = await provider.generateRecommendations(request({ model: 'some-model' }));

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(CHAT_URL);
      expect(options.headers.Authorization).toBe(`Bearer ${KEY}`);
      const body = JSON.parse(options.body);
      expect(body.model).toBe('some-model');
      const allText = body.messages.map((m: { content: string }) => m.content).join('\n');
      expect(allText).toContain('[ACTIVE]');
      expect(allText).toContain('Interstellar');
      expect(allText).toContain('pool_rankings');
      expect(result.recommendations.map((r) => r.movie.id)).toEqual([1]);
      expect(result.tasteAnalysis).toBe('Likes big ideas.');
    });

    it('parses JSON wrapped in reasoning tags and markdown fences', async () => {
      const wrapped = `<think>Let me think.</think>\n\`\`\`json\n${validContent}\n\`\`\``;
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okChat(wrapped)));

      const result = await provider.generateRecommendations(request());

      expect(result.recommendations).toHaveLength(1);
    });

    it('throws on an empty model response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okChat('')));

      await expect(provider.generateRecommendations(request())).rejects.toThrow(/empty/i);
    });

    it('surfaces a free-tier rate limit message in the thrown error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(apiError(429, 'Rate limit reached for tokens per minute'))
      );

      await expect(provider.generateRecommendations(request())).rejects.toThrow(
        /Groq.*Rate limit reached/
      );
    });

    it('passes a signal that aborts when the caller aborts', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okChat(validContent));
      vi.stubGlobal('fetch', fetchMock);
      const controller = new AbortController();

      await provider.generateRecommendations(request(), controller.signal);
      const passed: AbortSignal = fetchMock.mock.calls[0][1].signal;
      expect(passed.aborted).toBe(false);

      controller.abort();
      expect(passed.aborted).toBe(true);
    });
  });

  describe('fetchGroqModels', () => {
    const modelsResponse = {
      ok: true,
      json: async () => ({
        data: [
          { id: 'whisper-large-v3', active: true },
          { id: 'playai-tts', active: true },
          { id: 'canopylabs/orpheus-v1-english', active: true },
          { id: 'meta-llama/llama-guard-4-12b', active: true },
          { id: 'retired-model', active: false },
          { id: 'zeta-chat', active: true },
          { id: 'alpha-chat', active: true },
        ],
      }),
    };

    it('calls the models endpoint with a Bearer header and passes the signal', async () => {
      const fetchMock = vi.fn().mockResolvedValue(modelsResponse);
      vi.stubGlobal('fetch', fetchMock);
      const controller = new AbortController();

      await fetchGroqModels(`  ${KEY} `, controller.signal);

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(MODELS_URL);
      expect(options.headers.Authorization).toBe(`Bearer ${KEY}`);
      controller.abort();
      expect(options.signal.aborted).toBe(true);
    });

    it('returns only active chat models, sorted by id', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(modelsResponse));

      const models = await fetchGroqModels(KEY);

      expect(models.map((m) => m.id)).toEqual(['alpha-chat', 'zeta-chat']);
    });

    it('rejects a blank key without calling the network', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchGroqModels('  ')).rejects.toThrow('API key is required');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws the API error message, without the key', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(apiError(401, 'Invalid API Key')));

      const error = await fetchGroqModels(KEY).catch((e: Error) => e);

      expect((error as Error).message).toContain('Invalid API Key');
      expect((error as Error).message).not.toContain(KEY);
    });

    it('throws on a malformed list instead of returning nothing silently', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nope: true }) })
      );

      await expect(fetchGroqModels(KEY)).rejects.toThrow();
    });
  });

  describe('sanitizeGroqModel', () => {
    it('falls back to the default for missing or blank values', () => {
      expect(sanitizeGroqModel(undefined)).toBe(GROQ_DEFAULT_MODEL);
      expect(sanitizeGroqModel('   ')).toBe(GROQ_DEFAULT_MODEL);
      expect(sanitizeGroqModel(42 as unknown as string)).toBe(GROQ_DEFAULT_MODEL);
    });

    it('keeps and trims any other id, since the list is live', () => {
      expect(sanitizeGroqModel('  brand-new-model ')).toBe('brand-new-model');
    });
  });

  describe('aiManager with groq', () => {
    it('falls back to local without calling Groq when no key is set', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await aiManager.generateRecommendations('groq', request({ apiKey: '' }));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.usedProvider).toContain('Local');
      expect(result.usedProvider).toContain('Groq');
    });

    it('falls back to local and reports the error when Groq rate limits', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(apiError(429, 'Rate limit reached for tokens per minute'))
      );

      const result = await aiManager.generateRecommendations('groq', request());

      expect(result.error).toContain('Rate limit reached');
      expect(result.usedProvider).toContain('Local');
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });
});

describe('Groq platform wiring (frozen)', () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

  it('allows api.groq.com in the CSP connect-src', () => {
    const connectSrc = read('index.html').match(/connect-src[^;]*;/)?.[0] ?? '';
    expect(connectSrc).toContain('https://api.groq.com');
  });

  it('stores the Groq key in the Android vault, and an all-Groq vault is not empty', () => {
    const vault = read('android/app/src/main/java/com/cinematch/app/CredentialVault.java');
    expect(vault).toMatch(/groqApiKey\.isEmpty\(\)/);
    expect(vault).toMatch(/json\.put\("groqApiKey"/);
    expect(vault).toMatch(/optString\("groqApiKey", ""\)/);
    expect(vault).toMatch(/validateFieldBound\("groqApiKey"/);
    expect(vault).toContain('SCHEMA_VERSION = 1;');
  });

  it('passes the Groq key through the Android plugin in both directions', () => {
    const plugin = read('android/app/src/main/java/com/cinematch/app/CredentialVaultPlugin.java');
    expect(plugin).toMatch(/creds\.put\("groqApiKey"/);
    expect(plugin).toMatch(/key\.equals\("groqApiKey"\)/);
    expect(plugin).toMatch(/optString\("groqApiKey", ""\)/);
  });
});
