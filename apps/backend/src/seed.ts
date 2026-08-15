import type { Comment, Signal } from '@creatorsignal/shared'
import { normalizeTopic, topicLabel } from '@creatorsignal/shared'
import type { Store } from './db.js'

// ---------------------------------------------------------------------------
// Deterministic dataset used as a TEST FIXTURE (never wired into the runtime).
//
// The story: a geography/history creator whose audience keeps asking the same
// unanswered question about Bir Tawil across six videos. 47 asks, 12 highly
// engaged community members, plus healthy noise on other topics.
// ---------------------------------------------------------------------------

const VIDEOS = [
  { id: 'v1', title: "Why Doesn't Egypt Claim Bir Tawil?" },
  { id: 'v2', title: 'The Weirdest Border on Earth' },
  { id: 'v3', title: "No Man's Land: Bir Tawil Explained" },
  { id: 'v4', title: "Africa's Disputed Borders" },
  { id: 'v5', title: 'The Halaib Triangle Showdown' },
  { id: 'v6', title: 'Territorial Oddities Nobody Talks About' },
] as const

const ACTIVE_AUTHORS = [
  { id: 'a01', name: 'GeoCurious_MK', birTawilCount: 4 },
  { id: 'a02', name: 'MapNerd_Jane', birTawilCount: 3 },
  { id: 'a03', name: 'BorderlineFacts', birTawilCount: 3 },
  { id: 'a04', name: 'Atlas_Addict', birTawilCount: 3 },
  { id: 'a05', name: 'HistoryHawk_77', birTawilCount: 2 },
  { id: 'a06', name: 'TerraIncognita', birTawilCount: 2 },
  { id: 'a07', name: 'Cartophile_Rob', birTawilCount: 2 },
  { id: 'a08', name: 'SovereignMaps', birTawilCount: 2 },
  { id: 'a09', name: 'OddBorderBen', birTawilCount: 2 },
  { id: 'a10', name: 'GeoTrivia_Lena', birTawilCount: 2 },
  { id: 'a11', name: 'Boundary_Breaker', birTawilCount: 1 },
  { id: 'a12', name: 'PixelPlaceNames', birTawilCount: 1 },
] as const

// Every variant below normalizes to the same topic key: bir claim egypt tawil
const BIR_TAWIL_VARIANTS = [
  "why doesn't egypt claim bir tawil?",
  'why doesnt egypt claim bir tawil',
  "why won't egypt claim bir tawil",
  'why hasnt egypt claimed bir tawil yet',
  'why does egypt not claim bir tawil',
  'why is bir tawil not claimed by egypt',
  'egypt never claims bir tawil, why?',
  "why doesn't egypt just claim bir tawil",
]

const HALAIB = [
  'why is the halaib triangle disputed',
  'explain the halaib triangle',
  'halaib triangle video when',
  'do the halaib triangle next',
  'halaib triangle explained please',
  'why does sudan want the halaib triangle',
  'more on the halaib triangle border',
]

const MINOAN = [
  'make a video on the minoan civilization',
  'do the minoan civilization next',
  'cover the minoans please',
  'minoan civilization when',
  'explain the minoan civilization',
  'what happened to the minoans',
  'minoan palaces video please',
]

const BRONZE_AGE = [
  'explain the bronze age collapse',
  'bronze age collapse video when',
  'do the bronze age collapse next',
  'what caused the bronze age collapse',
  'bronze age collapse deep dive please',
]

const PRAISE = [
  'love the bir tawil episode',
  'amazing content as always',
  'best geography channel on youtube',
  'your maps are incredible',
  'thank you for this video',
  'this channel is criminally underrated',
  'the bir tawil video was fantastic',
  'great breakdown of the border',
  'please keep these videos coming',
  'this is exactly the content i wanted',
  'brilliant explainer as always',
  'you deserve way more subscribers',
]

const CRITIQUE = [
  'the audio was a bit low in this one',
  'the map graphics felt confusing here',
  'you got the halaib facts wrong',
  'wish the video was longer',
  'the pacing was too slow this time',
]

const MISC_QUESTIONS = [
  'what happened to the mali empire',
  'who owns the antarctica claims',
  'do a video on san marino',
  'how do enclaves even work',
  'why is baarle-nassau split like that',
  'when is the next video coming',
  'what about the korean border',
  'explain exclaves please',
  'why does spain own ceuta',
  'do the caspian sea dispute next',
]

// Deterministic PRNG so the dataset is identical on every seed.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildDemoComments(): Comment[] {
  const rand = mulberry32(42)
  const now = Date.now()
  const comments: Comment[] = []
  let counter = 0

  const push = (
    videoId: string,
    authorId: string,
    authorName: string,
    text: string,
    dayOffset: number,
    platform: Comment['platform'] = 'youtube',
  ): void => {
    counter++
    const publishedAt = new Date(
      now - dayOffset * 86_400_000 - Math.floor(rand() * 1_440) * 60_000,
    ).toISOString()
    comments.push({
      id: `demo-${String(counter).padStart(5, '0')}`,
      platform,
      videoId,
      authorId,
      authorName,
      text,
      publishedAt,
      ingestedAt: new Date(publishedAt).toISOString(),
    })
  }

  // The main story: 47 Bir Tawil asks across 6 videos.
  const birTawilVideos = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']
  for (const author of ACTIVE_AUTHORS) {
    for (let i = 0; i < author.birTawilCount; i++) {
      const videoId = birTawilVideos[(counter + i) % birTawilVideos.length]!
      const text = BIR_TAWIL_VARIANTS[(counter + i) % BIR_TAWIL_VARIANTS.length]!
      push(videoId, author.id, author.name, text, counter % 14)
    }
  }
  for (let i = 0; i < 20; i++) {
    const videoId = birTawilVideos[counter % birTawilVideos.length]!
    const text = BIR_TAWIL_VARIANTS[(counter + i) % BIR_TAWIL_VARIANTS.length]!
    push(videoId, `o${String(i + 1).padStart(2, '0')}`, `Viewer_${i + 1}`, text, counter % 14)
  }

  // Supporting noise.
  const authors = [...ACTIVE_AUTHORS]
  const oneOffs = Array.from({ length: 20 }, (_, i) => ({
    id: `o${String(i + 1).padStart(2, '0')}`,
    name: `Viewer_${i + 1}`,
  }))

  const spread = (pool: readonly string[], target: readonly string[], authorsPool: readonly { id: string; name: string }[]): void => {
    for (let i = 0; i < pool.length; i++) {
      const text = pool[i]!
      const targetVideo = target[i % target.length]!
      const author = authorsPool[counter % authorsPool.length]!
      push(targetVideo, author.id, author.name, text, 1 + (counter % 13))
    }
  }

  spread(HALAIB, ['v1', 'v5', 'v6'], authors)
  spread(MINOAN, ['v3', 'v4', 'v6'], authors)
  spread(BRONZE_AGE, ['v2', 'v4'], authors)
  spread(PRAISE, ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'], oneOffs)
  spread(CRITIQUE, ['v1', 'v2', 'v5'], authors)
  spread(MISC_QUESTIONS, ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'], oneOffs)

  // Cross-platform signals: the same creator also gets asked the same
  // question on TikTok and X, which is what pushes demand past the threshold.
  const TIKTOK_COMMENTS = [
    'why does egypt not claim bir tawil',
    'do bir tawil on tiktok',
    'explain the bir tawil border',
    'is bir tawil real',
    'why is bir tawil unclaimed',
  ]
  const X_COMMENTS = [
    'egypt could claim bir tawil any time, why not',
    'bir tawil thread when',
    'the bir tawil map is wild',
    'why does no one own bir tawil',
    'explain bir tawil in a thread',
  ]
  for (let i = 0; i < TIKTOK_COMMENTS.length; i++) {
    push('v1', `tt:${i + 1}`, `TTViewer_${i + 1}`, TIKTOK_COMMENTS[i]!, 2 + (i % 4), 'tiktok')
  }
  for (let i = 0; i < X_COMMENTS.length; i++) {
    push('v1', `x:${i + 1}`, `XUser_${i + 1}`, X_COMMENTS[i]!, 3 + (i % 4), 'x')
  }

  return comments
}

/**
 * Wipes the operational tables and loads the demo dataset. Signals are
 * derived by the distiller later, exactly like a real ingestion run.
 */
export function seedDatabase(store: Store): number {
  store.reset()
  const comments = buildDemoComments()
  let inserted = 0
  for (const comment of comments) {
    if (store.insertComment(comment)) inserted++
  }
  return inserted
}

/** Signal view used by tests: classify each demo comment with the fallback rules. */
export function demoSignals(comments: Comment[]): Signal[] {
  return comments.map((c) => {
    const topic = normalizeTopic(c.text)
    return {
      id: `sig-${c.id}`,
      commentId: c.id,
      platform: c.platform,
      videoId: c.videoId,
      authorId: c.authorId,
      authorName: c.authorName,
      kind: 'question',
      topic,
      topicLabel: topicLabel(topic),
      text: c.text,
      sentiment: 'neutral',
      ingestedAt: c.ingestedAt,
    }
  })
}

export { VIDEOS }
