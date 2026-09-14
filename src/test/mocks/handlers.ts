import { http, HttpResponse } from 'msw';

export const handlers = [
  // TMDB mock handlers
  http.get('https://api.themoviedb.org/3/movie/:id', ({ params }) => {
    return HttpResponse.json({
      id: Number(params.id),
      title: `Mock Movie ${params.id}`,
      overview: 'Mock overview for testing.',
      poster_path: '/mock_poster.jpg',
      backdrop_path: '/mock_backdrop.jpg',
      release_date: '2023-01-01',
      vote_average: 8.0,
      vote_count: 1000,
      genres: [{ id: 28, name: 'Action' }, { id: 878, name: 'Sci-Fi' }],
      credits: {
        crew: [{ job: 'Director', name: 'Mock Director' }],
      },
      keywords: {
        keywords: [{ id: 1, name: 'mind-bending' }],
      },
      videos: {
        results: [{ site: 'YouTube', type: 'Trailer', key: 'mock_trailer_key' }],
      },
      external_ids: {
        imdb_id: 'tt1234567',
      },
    });
  }),

  http.get('https://api.themoviedb.org/3/discover/movie', () => {
    return HttpResponse.json({
      page: 1,
      results: [
        {
          id: 101,
          title: 'Candidate Film A',
          overview: 'Mind-bending sci-fi thriller',
          poster_path: '/posterA.jpg',
          backdrop_path: '/backdropA.jpg',
          release_date: '2022-05-10',
          vote_average: 8.2,
          vote_count: 1500,
          genre_ids: [878, 53],
        },
        {
          id: 102,
          title: 'Candidate Film B',
          overview: 'Action adventure in space',
          poster_path: '/posterB.jpg',
          backdrop_path: '/backdropB.jpg',
          release_date: '2021-08-20',
          vote_average: 7.6,
          vote_count: 2200,
          genre_ids: [28, 878],
        },
      ],
      total_pages: 1,
      total_results: 2,
    });
  }),

  http.get('https://api.themoviedb.org/3/search/movie', ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('query') || '';
    return HttpResponse.json({
      page: 1,
      results: [
        {
          id: 201,
          title: query || 'Searched Film',
          overview: 'Search result film overview',
          poster_path: '/search_poster.jpg',
          release_date: '2020-01-01',
          vote_average: 7.5,
          vote_count: 800,
          genre_ids: [18],
        },
      ],
      total_pages: 1,
      total_results: 1,
    });
  }),

  http.get('https://api.themoviedb.org/3/movie/:id/recommendations', () => {
    return HttpResponse.json({
      page: 1,
      results: [
        {
          id: 301,
          title: 'Recommended Film 1',
          overview: 'Great matching recommendation',
          poster_path: '/rec1.jpg',
          release_date: '2019-11-01',
          vote_average: 8.1,
          vote_count: 1200,
          genre_ids: [878, 18],
        },
      ],
      total_pages: 1,
      total_results: 1,
    });
  }),

  http.get('https://api.themoviedb.org/3/movie/:id/similar', () => {
    return HttpResponse.json({
      page: 1,
      results: [],
      total_pages: 1,
      total_results: 0,
    });
  }),

  // Gemini Mock
  http.post('https://generativelanguage.googleapis.com/v1beta/models/:model', async () => {
    return HttpResponse.json({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  tasteAnalysis: 'User enjoys cerebral science fiction with high visual tension.',
                  pool_rankings: [
                    {
                      id: 101,
                      score: 95,
                      reason: 'Matches taste for thoughtful cerebral sci-fi.',
                      serendipityType: 'safe_bet',
                      highlightTags: ['Sci-Fi', 'High Tension'],
                    },
                  ],
                  unconstrained_discoveries: [],
                }),
              },
            ],
          },
        },
      ],
    });
  }),

  // OpenRouter Mock
  http.post('https://openrouter.ai/api/v1/chat/completions', async () => {
    return HttpResponse.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              tasteAnalysis: 'OpenRouter synthesized profile.',
              pool_rankings: [
                {
                  id: 102,
                  score: 92,
                  reason: 'High affinity for action space adventures.',
                  serendipityType: 'thematic_gem',
                  highlightTags: ['Action', 'Space'],
                },
              ],
              unconstrained_discoveries: [],
            }),
          },
        },
      ],
    });
  }),
];
