import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TonightPicks } from '../TonightPicks';
import type { Recommendation } from '../../types';

function makePick(
  id: number,
  title: string,
  bucket: Recommendation['bucket'],
  reason: string,
  overrides: Partial<Recommendation['movie']> = {}
): Recommendation {
  return {
    movie: {
      id,
      title,
      overview: `Overview for ${title}`,
      poster_path: `/poster-${id}.jpg`,
      backdrop_path: null,
      release_date: '2021-07-15',
      vote_average: 8.2,
      vote_count: 1500,
      genres: [{ id: 18, name: 'Drama' }],
      ...overrides,
    },
    score: 90 - id,
    rank: id,
    reason,
    serendipityType:
      bucket === 'wildcard'
        ? 'wildcard_discovery'
        : bucket === 'stretch'
        ? 'thematic_gem'
        : 'safe_bet',
    highlightTags: ['Drama'],
    bucket,
  };
}

describe('TonightPicks', () => {
  const samplePicks: Recommendation[] = [
    makePick(
      1,
      'Past Lives',
      'safe_bet',
      'Close match for your favorite dramas (8.4/10 TMDB). A second sentence that should not appear.',
      { release_date: '2023-06-02', poster_path: '/past-lives.jpg' }
    ),
    makePick(
      2,
      'Cure',
      'stretch',
      'A stretch into 1990s Japanese psychological thrillers. Extra context here.',
      { release_date: '1997-12-27', poster_path: '/cure.jpg' }
    ),
    makePick(
      3,
      'House',
      'wildcard',
      'Wild and inventive midnight cinema! You should skip the details.',
      { release_date: '1977-08-26', poster_path: null }
    ),
  ];

  it('renders an h2 named "Tonight" that labels the section and includes the subtitle', () => {
    render(<TonightPicks picks={samplePicks} onOpen={vi.fn()} />);

    const heading = screen.getByRole('heading', { level: 2, name: 'Tonight' });
    const region = screen.getByRole('region', { name: 'Tonight' });

    expect(heading.tagName).toBe('H2');
    expect(region.tagName).toBe('SECTION');
    expect(region).toHaveAttribute('aria-labelledby', heading.id);
    expect(screen.getByText('Three picks if you only have one evening.')).toBeInTheDocument();
  });

  it('renders 3 card buttons with w342 poster, alt text, title, year, BucketBadge, and first sentence of reason', () => {
    render(<TonightPicks picks={samplePicks} onOpen={vi.fn()} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);

    // Decorative poster: the title text names the button, so the image has empty alt text.
    const posterOne = buttons[0].querySelector('img');
    expect(posterOne).toHaveAttribute('alt', '');
    expect(posterOne).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w342/past-lives.jpg');
    expect(screen.getByText('Past Lives')).toBeInTheDocument();
    expect(screen.getByText('(2023)')).toBeInTheDocument();
    expect(screen.getByText('Safe pick')).toBeInTheDocument();
    expect(
      screen.getByText('Close match for your favorite dramas (8.4/10 TMDB).')
    ).toBeInTheDocument();
    expect(screen.queryByText(/second sentence/i)).toBeNull();

    expect(screen.getByText('A stretch for you')).toBeInTheDocument();
    expect(
      screen.getByText('A stretch into 1990s Japanese psychological thrillers.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Extra context here/i)).toBeNull();

    expect(screen.getByText('Wildcard')).toBeInTheDocument();
    expect(screen.getByText('Wild and inventive midnight cinema!')).toBeInTheDocument();
    expect(screen.getByText('No Poster')).toBeInTheDocument();
  });

  it('calls onOpen with the clicked recommendation', () => {
    const onOpen = vi.fn();
    render(<TonightPicks picks={samplePicks} onOpen={onOpen} />);

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(samplePicks[1]);
  });

  it('renders a single pick without bucket or release date cleanly', () => {
    const singlePick: Recommendation[] = [
      makePick(99, 'Stalker', undefined, 'Hypnotic sci-fi pilgrimage', {
        release_date: '   ',
        poster_path: '/stalker.jpg',
      }),
    ];

    render(<TonightPicks picks={singlePick} onOpen={vi.fn()} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].querySelector('img')).toHaveAttribute(
      'src',
      'https://image.tmdb.org/t/p/w342/stalker.jpg'
    );
    expect(screen.getByText('Stalker')).toBeInTheDocument();
    expect(screen.getByText('Hypnotic sci-fi pilgrimage')).toBeInTheDocument();
    expect(screen.queryByText(/^\(/)).toBeNull();
    expect(screen.queryByText(/Safe pick|A stretch for you|Wildcard|Long shot/)).toBeNull();
  });

  it('renders nothing when picks is empty', () => {
    const { container } = render(<TonightPicks picks={[]} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
