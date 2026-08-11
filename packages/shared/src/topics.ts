// Topic normalization for audience signal clustering.
// The Mind clusters raw comments by normalized topic key, so "why doesn't
// egypt claim bir tawil" and "why hasnt egypt claimed bir tawil" land in the
// same cluster and the repeat counter can grow.

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'for', 'on', 'in', 'at',
  'with', 'from', 'about', 'by', 'is', 'are', 'was', 'were', 'be', 'been',
  'do', 'does', 'did', 'done', 'doesnt', 'dont', 'didnt', 'isnt', 'wasnt',
  'arent', 'has', 'have', 'had', 'hasnt', 'havent', 'not', 'no', 'never',
  'wont', 'wouldnt', 'yet',
  'i', 'me', 'my', 'you', 'your', 'we', 'us', 'our', 'they', 'them', 'their',
  'he', 'she', 'it', 'its', 'this', 'that', 'these', 'those', 'there',
  'what', 'why', 'when', 'where', 'how', 'who', 'which', 'whom', 'whose',
  'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must',
  'please', 'tell', 'ask', 'asked', 'wondering', 'wonder', 'wanna', 'want',
  'wants', 'need', 'needs', 'get', 'got', 'make', 'makes', 'making', 'made',
  'video', 'videos', 'content', 'channel', 'episode', 'episodes', 'part',
  'parts', 'series', 'next', 'new', 'one', 'two', 'anyone', 'everyone',
  'something', 'anything', 'thing', 'things', 'like', 'really', 'just',
  'even', 'still', 'much', 'more', 'most', 'lot', 'lots', 'some', 'any',
  'also', 'too', 'very', 'so', 'then', 'than', 'while', 'because', 'if',
  'though', 'tho', 'yeah', 'yes', 'yep', 'no', 'nope', 'ok', 'okay', 'hey',
  'hi', 'hello', 'guys', 'man', 'bro', 'dude', 'folks', 'everybody',
  'civilization', 'explain', 'explained', 'cover', 'covering', 'empire',
  'history', 'story', 'stories', 'facts', 'stuff', 'deal', 'palace', 'palac',
  'disput', 'wanna', 'gonna', 'kinda', 'sorta',
])

function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2)
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2)
  if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/**
 * Reduce free text to a stable cluster key: lowercase, punctuation stripped,
 * contractions flattened, stopwords dropped, tokens stemmed, deduped, sorted.
 */
export function normalizeTopic(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map(stem)
    .filter((t) => !STOPWORDS.has(t))
  const unique = [...new Set(tokens)]
  if (unique.length === 0) return 'general'
  return unique.sort().join(' ')
}

/**
 * Human readable label for a topic key, capitalized.
 */
export function topicLabel(topic: string): string {
  if (topic === 'general') return 'General'
  return topic
    .split(' ')
    .slice(0, 4)
    .map((t) => (t.length > 0 ? t[0]!.toUpperCase() + t.slice(1) : t))
    .join(' ')
}
