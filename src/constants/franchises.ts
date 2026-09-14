export interface FranchiseRule {
  key: string;
  match: string[];
}

/**
 * Curated Canonical Franchise Dictionary
 * Grouped tightly by specific sub-series (e.g. Iron Man, Thor, Spider-Man separate)
 * rather than overly broad mega-universes, so varied films aren't unnecessarily suppressed.
 */
export const FRANCHISE_ALIASES: FranchiseRule[] = [
  // --- Marvel Cinematic Universe & Adjacent (Tight Sub-Franchises) ---
  {
    key: 'franchise:spider-man',
    match: [
      'spider-man',
      'spiderman',
      'into the spider-verse',
      'across the spider-verse',
      'beyond the spider-verse',
      'no way home',
      'homecoming',
      'far from home',
    ],
  },
  {
    key: 'franchise:avengers',
    match: ['avengers', 'infinity war', 'endgame', 'age of ultron'],
  },
  {
    key: 'franchise:iron-man',
    match: ['iron man'],
  },
  {
    key: 'franchise:captain-america',
    match: ['captain america', 'the winter soldier', 'civil war', 'brave new world'],
  },
  {
    key: 'franchise:thor',
    match: ['thor: ragnarok', 'thor: love and thunder', 'thor: the dark world', 'thor'],
  },
  {
    key: 'franchise:guardians-of-the-galaxy',
    match: ['guardians of the galaxy'],
  },
  {
    key: 'franchise:deadpool-wolverine',
    match: ['deadpool', 'deadpool & wolverine', 'deadpool 2', 'logan', 'the wolverine', 'x-men origins: wolverine'],
  },
  {
    key: 'franchise:x-men',
    match: ['x-men', 'days of future past', 'first class', 'x-men: apocalypse', 'dark phoenix', 'the new mutants'],
  },
  {
    key: 'franchise:black-panther',
    match: ['black panther', 'wakanda forever'],
  },
  {
    key: 'franchise:doctor-strange',
    match: ['doctor strange', 'multiverse of madness'],
  },
  {
    key: 'franchise:ant-man',
    match: ['ant-man', 'ant-man and the wasp', 'quantumania'],
  },
  {
    key: 'franchise:venom',
    match: ['venom', 'let there be carnage', 'the last dance'],
  },
  {
    key: 'franchise:fantastic-four',
    match: ['fantastic four', 'rise of the silver surfer', 'first steps'],
  },

  // --- DC Universe (Tight Sub-Franchises) ---
  {
    key: 'franchise:batman',
    match: ['batman', 'dark knight', 'the batman', 'batman begins', 'batman returns', 'batman forever'],
  },
  {
    key: 'franchise:joker',
    match: ['joker', 'folie à deux', 'folie a deux'],
  },
  {
    key: 'franchise:superman',
    match: ['superman', 'man of steel'],
  },
  {
    key: 'franchise:wonder-woman',
    match: ['wonder woman', 'wonder woman 1984'],
  },
  {
    key: 'franchise:aquaman',
    match: ['aquaman', 'the lost kingdom'],
  },
  {
    key: 'franchise:suicide-squad',
    match: ['suicide squad', 'the suicide squad', 'birds of prey'],
  },
  {
    key: 'franchise:justice-league',
    match: ['justice league', 'snyder cut'],
  },

  // --- Sci-Fi & Speculative ---
  {
    key: 'franchise:star-wars',
    match: [
      'star wars',
      'the phantom menace',
      'attack of the clones',
      'revenge of the sith',
      'a new hope',
      'the empire strikes back',
      'return of the jedi',
      'the force awakens',
      'the last jedi',
      'the rise of skywalker',
      'rogue one',
      'solo: a star wars story',
    ],
  },
  {
    key: 'franchise:star-trek',
    match: ['star trek', 'wrath of khan', 'first contact', 'into darkness', 'star trek beyond'],
  },
  {
    key: 'franchise:matrix',
    match: ['the matrix', 'matrix reloaded', 'matrix revolutions', 'matrix resurrections'],
  },
  {
    key: 'franchise:dune',
    match: ['dune: part one', 'dune: part two', 'dune'],
  },
  {
    key: 'franchise:alien',
    match: ['alien', 'aliens', 'alien 3', 'alien: resurrection', 'prometheus', 'alien: covenant', 'alien: romulus'],
  },
  {
    key: 'franchise:predator',
    match: ['predator', 'predators', 'the predator', 'prey'],
  },
  {
    key: 'franchise:terminator',
    match: ['terminator', 'judgment day', 'rise of the machines', 'salvation', 'genisys', 'dark fate'],
  },
  {
    key: 'franchise:blade-runner',
    match: ['blade runner', 'blade runner 2049'],
  },
  {
    key: 'franchise:planet-of-the-apes',
    match: [
      'planet of the apes',
      'rise of the planet of the apes',
      'dawn of the planet of the apes',
      'war for the planet of the apes',
      'kingdom of the planet of the apes',
    ],
  },
  {
    key: 'franchise:transformers',
    match: ['transformers', 'bumblebee', 'rise of the beasts', 'dark of the moon', 'age of extinction', 'the last knight'],
  },
  {
    key: 'franchise:jurassic',
    match: ['jurassic park', 'the lost world: jurassic park', 'jurassic park iii', 'jurassic world', 'fallen kingdom', 'dominion'],
  },
  {
    key: 'franchise:avatar',
    match: ['avatar', 'the way of water', 'fire and ash'],
  },
  {
    key: 'franchise:monsterverse',
    match: ['godzilla', 'kong: skull island', 'godzilla vs. kong', 'godzilla x kong', 'king of the monsters', 'godzilla minus one'],
  },
  {
    key: 'franchise:mad-max',
    match: ['mad max', 'the road warrior', 'fury road', 'furiosa'],
  },
  {
    key: 'franchise:men-in-black',
    match: ['men in black', 'mib international'],
  },
  {
    key: 'franchise:back-to-the-future',
    match: ['back to the future'],
  },
  {
    key: 'franchise:ghostbusters',
    match: ['ghostbusters', 'afterlife', 'frozen empire'],
  },
  {
    key: 'franchise:tron',
    match: ['tron', 'tron: legacy', 'tron: ares'],
  },

  // --- Fantasy & Adventure ---
  {
    key: 'franchise:lotr',
    match: [
      'lord of the rings',
      'the fellowship of the ring',
      'the two towers',
      'the return of the king',
      'fellowship of the ring',
      'return of the king',
    ],
  },
  {
    key: 'franchise:hobbit',
    match: [
      'the hobbit',
      'an unexpected journey',
      'the desolation of smaug',
      'the battle of the five armies',
    ],
  },
  {
    key: 'franchise:harry-potter',
    match: [
      'harry potter',
      "sorcerer's stone",
      "philosopher's stone",
      'chamber of secrets',
      'prisoner of azkaban',
      'goblet of fire',
      'order of the phoenix',
      'half-blood prince',
      'deathly hallows',
    ],
  },
  {
    key: 'franchise:fantastic-beasts',
    match: ['fantastic beasts', 'the crimes of grindelwald', 'the secrets of dumbledore'],
  },
  {
    key: 'franchise:indiana-jones',
    match: [
      'indiana jones',
      'raiders of the lost ark',
      'temple of doom',
      'the last crusade',
      'kingdom of the crystal skull',
      'dial of destiny',
    ],
  },
  {
    key: 'franchise:pirates-of-the-caribbean',
    match: [
      'pirates of the caribbean',
      'curse of the black pearl',
      "dead man's chest",
      "at world's end",
      'on stranger tides',
      'dead men tell no tales',
      'salazar',
    ],
  },
  {
    key: 'franchise:hunger-games',
    match: ['the hunger games', 'hunger games', 'catching fire', 'mockingjay', 'the ballad of songbirds'],
  },
  {
    key: 'franchise:twilight',
    match: ['twilight', 'new moon', 'eclipse', 'breaking dawn'],
  },
  {
    key: 'franchise:narnia',
    match: [
      'chronicles of narnia',
      'the lion, the witch and the wardrobe',
      'prince caspian',
      'the voyage of the dawn treader',
    ],
  },
  {
    key: 'franchise:maze-runner',
    match: ['the maze runner', 'maze runner', 'the scorch trials', 'the death cure'],
  },

  // --- Action, Crime & Thrillers ---
  {
    key: 'franchise:james-bond',
    match: [
      'james bond',
      '007',
      'casino royale',
      'quantum of solace',
      'skyfall',
      'spectre',
      'no time to die',
      'goldeneye',
      'goldfinger',
      'from russia with love',
      'die another day',
      'the world is not enough',
      'tomorrow never dies',
    ],
  },
  {
    key: 'franchise:mission-impossible',
    match: [
      'mission: impossible',
      'mission impossible',
      'ghost protocol',
      'rogue nation',
      'fallout',
      'dead reckoning',
    ],
  },
  {
    key: 'franchise:john-wick',
    match: ['john wick', 'ballerina'],
  },
  {
    key: 'franchise:fast-and-furious',
    match: [
      'fast & furious',
      'fast and furious',
      'furious 7',
      'fast x',
      'the fate of the furious',
      'tokyo drift',
      'hobbs & shaw',
      'fast five',
    ],
  },
  {
    key: 'franchise:bourne',
    match: ['the bourne identity', 'the bourne supremacy', 'the bourne ultimatum', 'the bourne legacy', 'jason bourne'],
  },
  {
    key: 'franchise:die-hard',
    match: ['die hard', 'die hard 2', 'with a vengeance', 'live free or die hard', 'a good day to die hard'],
  },
  {
    key: 'franchise:oceans',
    match: [
      "ocean's eleven",
      "ocean's twelve",
      "ocean's thirteen",
      "ocean's 8",
      "oceans eleven",
      "oceans 11",
      "oceans 12",
      "oceans 13",
      "oceans 8",
    ],
  },
  {
    key: 'franchise:kingsman',
    match: ['kingsman', 'the secret service', 'the golden circle', "the king's man"],
  },
  {
    key: 'franchise:godfather',
    match: ['the godfather', 'the godfather part ii', 'the godfather part iii', 'the godfather coda'],
  },
  {
    key: 'franchise:knives-out',
    match: ['knives out', 'glass onion', 'wake up dead man'],
  },
  {
    key: 'franchise:sicario',
    match: ['sicario', 'day of the soldado'],
  },
  {
    key: 'franchise:sherlock-holmes',
    match: ['sherlock holmes', 'a game of shadows'],
  },
  {
    key: 'franchise:bad-boys',
    match: ['bad boys', 'bad boys ii', 'bad boys for life', 'bad boys: ride or die'],
  },
  {
    key: 'franchise:top-gun',
    match: ['top gun', 'top gun: maverick'],
  },
  {
    key: 'franchise:taken',
    match: ['taken', 'taken 2', 'taken 3'],
  },
  {
    key: 'franchise:equalizer',
    match: ['the equalizer', 'the equalizer 2', 'the equalizer 3', 'equalizer'],
  },
  {
    key: 'franchise:jack-reacher',
    match: ['jack reacher', 'never go back'],
  },
  {
    key: 'franchise:expendables',
    match: ['the expendables', 'expendables', 'expend4bles'],
  },

  // --- Horror & Mystery ---
  {
    key: 'franchise:conjuring-universe',
    match: ['the conjuring', 'annabelle', 'the nun'],
  },
  {
    key: 'franchise:quiet-place',
    match: ['a quiet place', 'a quiet place: day one'],
  },
  {
    key: 'franchise:halloween',
    match: ['halloween', 'halloween kills', 'halloween ends'],
  },
  {
    key: 'franchise:scream',
    match: ['scream', 'scream 2', 'scream 3', 'scream 4', 'scream vi', 'scream 7'],
  },
  {
    key: 'franchise:saw',
    match: ['saw', 'jigsaw', 'spiral: from the book of saw', 'saw x'],
  },
  {
    key: 'franchise:insidious',
    match: ['insidious', 'the red door'],
  },
  {
    key: 'franchise:paranormal-activity',
    match: ['paranormal activity'],
  },
  {
    key: 'franchise:eastrail-177',
    match: ['unbreakable', 'split', 'glass'],
  },
  {
    key: 'franchise:hannibal',
    match: ['the silence of the lambs', 'silence of the lambs', 'hannibal', 'red dragon', 'hannibal rising'],
  },
  {
    key: 'franchise:final-destination',
    match: ['final destination', 'bloodlines'],
  },
  {
    key: 'franchise:evil-dead',
    match: ['the evil dead', 'evil dead ii', 'army of darkness', 'evil dead rise'],
  },

  // --- Drama & Romance ---
  {
    key: 'franchise:before-trilogy',
    match: ['before sunrise', 'before sunset', 'before midnight'],
  },
  {
    key: 'franchise:rocky-creed',
    match: ['rocky', 'rocky balboa', 'creed', 'creed ii', 'creed iii'],
  },
  {
    key: 'franchise:fifty-shades',
    match: ['fifty shades of grey', 'fifty shades darker', 'fifty shades freed'],
  },
  {
    key: 'franchise:bridget-jones',
    match: ['bridget jones', "bridget jones's diary", 'the edge of reason', "bridget jones's baby"],
  },

  // --- Animation & Family ---
  {
    key: 'franchise:toy-story',
    match: ['toy story', 'lightyear'],
  },
  {
    key: 'franchise:shrek',
    match: ['shrek', 'shrek 2', 'shrek the third', 'shrek forever after', 'puss in boots', 'the last wish'],
  },
  {
    key: 'franchise:despicable-me',
    match: ['despicable me', 'minions', 'the rise of gru'],
  },
  {
    key: 'franchise:finding-nemo',
    match: ['finding nemo', 'finding dory'],
  },
  {
    key: 'franchise:incredibles',
    match: ['the incredibles', 'incredibles 2'],
  },
  {
    key: 'franchise:monsters-inc',
    match: ['monsters, inc.', 'monsters university'],
  },
  {
    key: 'franchise:cars',
    match: ['cars', 'cars 2', 'cars 3', 'planes'],
  },
  {
    key: 'franchise:inside-out',
    match: ['inside out', 'inside out 2'],
  },
  {
    key: 'franchise:frozen',
    match: ['frozen', 'frozen ii', 'frozen 2'],
  },
  {
    key: 'franchise:how-to-train-your-dragon',
    match: ['how to train your dragon', 'the hidden world'],
  },
  {
    key: 'franchise:kung-fu-panda',
    match: ['kung fu panda'],
  },
  {
    key: 'franchise:madagascar',
    match: ['madagascar', 'escape 2 africa', 'europes most wanted', 'penguins of madagascar'],
  },
  {
    key: 'franchise:ice-age',
    match: ['ice age', 'the meltdown', 'dawn of the dinosaurs', 'continental drift', 'collision course'],
  },
  {
    key: 'franchise:hotel-transylvania',
    match: ['hotel transylvania', 'transformania'],
  },
  {
    key: 'franchise:paddington',
    match: ['paddington', 'paddington 2', 'paddington in peru'],
  },
  {
    key: 'franchise:lego-movie',
    match: ['the lego movie', 'the lego movie 2', 'the lego batman movie', 'the lego ninjago movie'],
  },

  // --- Comedy & Buddy Series ---
  {
    key: 'franchise:hangover',
    match: ['the hangover', 'hangover part ii', 'hangover part iii'],
  },
  {
    key: 'franchise:pitch-perfect',
    match: ['pitch perfect', 'pitch perfect 2', 'pitch perfect 3'],
  },
  {
    key: 'franchise:jump-street',
    match: ['21 jump street', '22 jump street'],
  },
  {
    key: 'franchise:fockers',
    match: ['meet the parents', 'meet the fockers', 'little fockers'],
  },
  {
    key: 'franchise:austin-powers',
    match: ['austin powers', 'the spy who shagged me', 'goldmember'],
  },
  {
    key: 'franchise:ted',
    match: ['ted', 'ted 2'],
  },
];

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalizes title strings by:
 * - Converting to lower case
 * - Stripping diacritics / accents (e.g. folie à deux -> folie a deux)
 * - Standardizing apostrophes/quotes
 */
export function normalizeForMatching(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '');
}

/**
 * Checks whether a normalized pattern matches the normalized title
 * using word boundary/token boundary constraints to avoid substring false positives
 * (e.g. "thor" must not match "author", "ted" must not match "united").
 */
export function matchesFranchiseAlias(normalizedTitle: string, rawAlias: string): boolean {
  const normalizedAlias = normalizeForMatching(rawAlias).trim();
  if (!normalizedAlias) return false;

  const escaped = escapeRegExp(normalizedAlias);
  // Match as an isolated token sequence surrounded by non-alphanumeric boundaries or string edges
  const regex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i');
  return regex.test(normalizedTitle);
}

/**
 * Fast synchronous series identification.
 * 1. Checks specific curated franchise rules with token-aware matching.
 * 2. Applies intelligent title stemming to automatically catch sequels,
 *    subtitles, Roman numerals, and volume/chapter tags with 0 network overhead.
 */
export function getSeriesKey(movieId: number, title: string): string {
  const normalized = normalizeForMatching(title).trim();

  // 1. Check curated franchise alias dictionary
  for (const f of FRANCHISE_ALIASES) {
    if (f.match.some((m) => matchesFranchiseAlias(normalized, m))) {
      return f.key;
    }
  }

  // 2. Intelligent Title Stemmer:
  // Strip leading articles (The, A, An)
  let clean = normalized.replace(/^(the|a|an)\s+/i, '').trim();

  // Strip subtitle dividers (:, -, —, –, |)
  if (clean.includes(':')) clean = clean.split(':')[0].trim();
  else if (clean.includes(' - ')) clean = clean.split(' - ')[0].trim();
  else if (clean.includes(' – ')) clean = clean.split(' – ')[0].trim();
  else if (clean.includes(' — ')) clean = clean.split(' — ')[0].trim();
  else if (clean.includes(' | ')) clean = clean.split(' | ')[0].trim();

  // Strip sequel descriptors and numerals e.g. "Part 2", "Chapter II", "Vol. 3", "Episode IV", "3"
  clean = clean
    .replace(/\s+(part|chapter|vol\.?|volume|episode|reloaded|revolutions|resurrections)?\s*([0-9]+|[ivxlcdm]+)$/i, '')
    .trim();

  // Strip trailing punctuation
  clean = clean.replace(/[^\w\s]/gi, '').trim();

  return `stem:${clean || normalized}`;
}
