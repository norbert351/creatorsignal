import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  Comment,
  CreatorMemoryEntry,
  CreatorMemoryKind,
  Decision,
  Digest,
  Fan,
  Opportunity,
  OpportunityStatus,
  Signal,
  SignalKind,
} from '@creatorsignal/shared'

const DDL = `
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'youtube',
  video_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  text TEXT NOT NULL,
  published_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id);
CREATE INDEX IF NOT EXISTS idx_comments_platform ON comments(platform);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'youtube',
  video_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  topic TEXT NOT NULL,
  topic_label TEXT NOT NULL,
  text TEXT NOT NULL,
  sentiment TEXT NOT NULL,
  ingested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_topic ON signals(topic);
CREATE INDEX IF NOT EXISTS idx_signals_kind ON signals(kind);
CREATE INDEX IF NOT EXISTS idx_signals_platform ON signals(platform);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL UNIQUE,
  topic_label TEXT NOT NULL,
  demand_score REAL NOT NULL,
  repeat_count INTEGER NOT NULL,
  video_count INTEGER NOT NULL,
  unanswered INTEGER NOT NULL,
  status TEXT NOT NULL,
  related_author_ids TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fans (
  author_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  engagement_count INTEGER NOT NULL,
  question_count INTEGER NOT NULL,
  topics TEXT NOT NULL,
  superfan_score REAL NOT NULL,
  last_active_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creator_memory (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  ref_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_kind ON creator_memory(kind);

CREATE TABLE IF NOT EXISTS digests (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  items TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_targets_user ON targets(user_id);
CREATE INDEX IF NOT EXISTS idx_targets_platform ON targets(platform);

CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS videos (
  video_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

interface RawRow {
  [key: string]: unknown
}

function bool(value: unknown): boolean {
  return value === 1 || value === true
}

function jsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || value.length === 0) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export class Store {
  private readonly db: DatabaseSync

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true })
    }
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(DDL)
  }

  close(): void {
    this.db.close()
  }

  // -------------------------------------------------------------------------
  // Comments
  // -------------------------------------------------------------------------

  /** Returns true when the comment was new. */
  insertComment(comment: Comment): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO comments (id, platform, video_id, author_id, author_name, text, published_at, ingested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        comment.id,
        comment.platform,
        comment.videoId,
        comment.authorId,
        comment.authorName,
        comment.text,
        comment.publishedAt,
        comment.ingestedAt,
      )
    return Number(result.changes) > 0
  }

  listComments(videoId?: string): Comment[] {
    const rows: RawRow[] =
      videoId === undefined
        ? (this.db.prepare('SELECT * FROM comments ORDER BY published_at DESC').all() as RawRow[])
        : (this.db
            .prepare('SELECT * FROM comments WHERE video_id = ? ORDER BY published_at DESC')
            .all(videoId) as RawRow[])
    return rows.map((r) => this.rowToComment(r))
  }

  listUnsignaledComments(limit: number): Comment[] {
    const rows: RawRow[] = this.db
      .prepare(
        `SELECT c.* FROM comments c
         LEFT JOIN signals s ON s.comment_id = c.id
         WHERE s.id IS NULL
         ORDER BY c.published_at
         LIMIT ?`,
      )
      .all(limit) as RawRow[]
    return rows.map((r) => this.rowToComment(r))
  }

  private rowToComment(r: RawRow): Comment {
    return {
      id: String(r.id),
      platform: (String(r.platform) ?? 'youtube') as Comment['platform'],
      videoId: String(r.video_id),
      authorId: String(r.author_id),
      authorName: String(r.author_name),
      text: String(r.text),
      publishedAt: String(r.published_at),
      ingestedAt: String(r.ingested_at),
    }
  }

  // -------------------------------------------------------------------------
  // Signals
  // -------------------------------------------------------------------------

  insertSignals(signals: Signal[]): number {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO signals
         (id, comment_id, platform, video_id, author_id, author_name, kind, topic, topic_label, text, sentiment, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    let inserted = 0
    for (const s of signals) {
      const result = stmt.run(
        s.id,
        s.commentId,
        s.platform,
        s.videoId,
        s.authorId,
        s.authorName,
        s.kind,
        s.topic,
        s.topicLabel,
        s.text,
        s.sentiment,
        s.ingestedAt,
      )
      if (Number(result.changes) > 0) inserted++
    }
    return inserted
  }

  listSignals(kind?: SignalKind): Signal[] {
    const rows: RawRow[] =
      kind === undefined
        ? (this.db.prepare('SELECT * FROM signals ORDER BY ingested_at ASC').all() as RawRow[])
        : (this.db
            .prepare('SELECT * FROM signals WHERE kind = ? ORDER BY ingested_at ASC')
            .all(kind) as RawRow[])
    return rows.map((r) => this.rowToSignal(r))
  }

  private rowToSignal(r: RawRow): Signal {
    return {
      id: String(r.id),
      commentId: String(r.comment_id),
      platform: (String(r.platform) ?? 'youtube') as Signal['platform'],
      videoId: String(r.video_id),
      authorId: String(r.author_id),
      authorName: String(r.author_name),
      kind: String(r.kind) as Signal['kind'],
      topic: String(r.topic),
      topicLabel: String(r.topic_label),
      text: String(r.text),
      sentiment: String(r.sentiment) as Signal['sentiment'],
      ingestedAt: String(r.ingested_at),
    }
  }

  // -------------------------------------------------------------------------
  // Opportunities
  // -------------------------------------------------------------------------

  upsertOpportunity(opportunity: Opportunity): void {
    this.db
      .prepare(
        `INSERT INTO opportunities
           (id, topic, topic_label, demand_score, repeat_count, video_count, unanswered, status, related_author_ids, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(topic) DO UPDATE SET
           id = excluded.id,
           topic_label = excluded.topic_label,
           demand_score = excluded.demand_score,
           repeat_count = excluded.repeat_count,
           video_count = excluded.video_count,
           unanswered = excluded.unanswered,
           related_author_ids = excluded.related_author_ids,
           last_seen_at = excluded.last_seen_at`,
      )
      .run(
        opportunity.id,
        opportunity.topic,
        opportunity.topicLabel,
        opportunity.demandScore,
        opportunity.repeatCount,
        opportunity.videoCount,
        opportunity.unanswered ? 1 : 0,
        opportunity.status,
        JSON.stringify(opportunity.relatedAuthorIds),
        opportunity.firstSeenAt,
        opportunity.lastSeenAt,
      )
  }

  listOpportunities(status?: OpportunityStatus): Opportunity[] {
    const rows: RawRow[] =
      status === undefined
        ? (this.db
            .prepare('SELECT * FROM opportunities ORDER BY demand_score DESC')
            .all() as RawRow[])
        : (this.db
            .prepare('SELECT * FROM opportunities WHERE status = ? ORDER BY demand_score DESC')
            .all(status) as RawRow[])
    return rows.map((r) => this.rowToOpportunity(r))
  }

  getOpportunity(id: string): Opportunity | null {
    const row = this.db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as
      | RawRow
      | undefined
    return row ? this.rowToOpportunity(row) : null
  }

  getOpportunityByTopic(topic: string): Opportunity | null {
    const row = this.db.prepare('SELECT * FROM opportunities WHERE topic = ?').get(topic) as
      | RawRow
      | undefined
    return row ? this.rowToOpportunity(row) : null
  }

  updateOpportunityStatus(id: string, status: OpportunityStatus): void {
    this.db
      .prepare('UPDATE opportunities SET status = ? WHERE id = ?')
      .run(status, id)
  }

  private rowToOpportunity(r: RawRow): Opportunity {
    return {
      id: String(r.id),
      topic: String(r.topic),
      topicLabel: String(r.topic_label),
      demandScore: Number(r.demand_score),
      repeatCount: Number(r.repeat_count),
      videoCount: Number(r.video_count),
      unanswered: bool(r.unanswered),
      status: String(r.status) as OpportunityStatus,
      relatedAuthorIds: jsonArray(r.related_author_ids),
      firstSeenAt: String(r.first_seen_at),
      lastSeenAt: String(r.last_seen_at),
    }
  }

  // -------------------------------------------------------------------------
  // Fans
  // -------------------------------------------------------------------------

  upsertFan(fan: Fan): void {
    this.db
      .prepare(
        `INSERT INTO fans
           (author_id, name, engagement_count, question_count, topics, superfan_score, last_active_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(author_id) DO UPDATE SET
           name = excluded.name,
           engagement_count = excluded.engagement_count,
           question_count = excluded.question_count,
           topics = excluded.topics,
           superfan_score = excluded.superfan_score,
           last_active_at = excluded.last_active_at`,
      )
      .run(
        fan.authorId,
        fan.name,
        fan.engagementCount,
        fan.questionCount,
        JSON.stringify(fan.topics),
        fan.superfanScore,
        fan.lastActiveAt,
      )
  }

  listFans(minScore = 0): Fan[] {
    const rows: RawRow[] = this.db
      .prepare('SELECT * FROM fans WHERE superfan_score >= ? ORDER BY superfan_score DESC')
      .all(minScore) as RawRow[]
    return rows.map((r) => ({
      authorId: String(r.author_id),
      name: String(r.name),
      engagementCount: Number(r.engagement_count),
      questionCount: Number(r.question_count),
      topics: jsonArray(r.topics),
      superfanScore: Number(r.superfan_score),
      lastActiveAt: String(r.last_active_at),
    }))
  }

  // -------------------------------------------------------------------------
  // Decisions
  // -------------------------------------------------------------------------

  insertDecision(decision: Decision): void {
    this.db
      .prepare(
        `INSERT INTO decisions (id, opportunity_id, decision, note, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        decision.id,
        decision.opportunityId,
        decision.decision,
        decision.note,
        decision.createdAt,
      )
  }

  listDecisions(): Decision[] {
    const rows: RawRow[] = this.db
      .prepare('SELECT * FROM decisions ORDER BY created_at DESC')
      .all() as RawRow[]
    return rows.map((r) => ({
      id: String(r.id),
      opportunityId: String(r.opportunity_id),
      decision: String(r.decision) as Decision['decision'],
      note: String(r.note),
      createdAt: String(r.created_at),
    }))
  }

  // -------------------------------------------------------------------------
  // Creator memory
  // -------------------------------------------------------------------------

  insertCreatorMemory(entry: CreatorMemoryEntry): void {
    this.db
      .prepare(
        `INSERT INTO creator_memory (id, kind, content, ref_id, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(entry.id, entry.kind, entry.content, entry.refId, entry.createdAt)
  }

  listCreatorMemory(kind?: CreatorMemoryKind): CreatorMemoryEntry[] {
    const rows: RawRow[] =
      kind === undefined
        ? (this.db
            .prepare('SELECT * FROM creator_memory ORDER BY created_at DESC')
            .all() as RawRow[])
        : (this.db
            .prepare('SELECT * FROM creator_memory WHERE kind = ? ORDER BY created_at DESC')
            .all(kind) as RawRow[])
    return rows.map((r) => ({
      id: String(r.id),
      kind: String(r.kind) as CreatorMemoryKind,
      content: String(r.content),
      refId: r.ref_id === null ? null : String(r.ref_id),
      createdAt: String(r.created_at),
    }))
  }

  /** Topics the creator has covered or approved, as a Set of topic keys. */
  coveredTopics(): Set<string> {
    const covered = new Set<string>()
    for (const decision of this.listDecisions()) {
      if (decision.decision !== 'approved') continue
      const opp = this.getOpportunity(decision.opportunityId)
      if (opp) covered.add(opp.topic)
    }
    for (const entry of this.listCreatorMemory('covered')) {
      covered.add(entry.content)
    }
    return covered
  }

  // -------------------------------------------------------------------------
  // Digests
  // -------------------------------------------------------------------------

  insertDigest(digest: Digest): void {
    this.db
      .prepare('INSERT OR IGNORE INTO digests (id, created_at, items) VALUES (?, ?, ?)')
      .run(digest.id, digest.createdAt, JSON.stringify(digest.items))
  }

  listDigests(limit = 20): Digest[] {
    const rows: RawRow[] = this.db
      .prepare('SELECT * FROM digests ORDER BY created_at DESC LIMIT ?')
      .all(limit) as RawRow[]
    return rows.map((r) => {
      let items: Digest['items'] = []
      try {
        items = JSON.parse(String(r.items)) as Digest['items']
      } catch {
        items = []
      }
      return {
        id: String(r.id),
        createdAt: String(r.created_at),
        items,
      }
    })
  }

  // -------------------------------------------------------------------------
  // Channel state (ingestion cursors)
  // -------------------------------------------------------------------------

  getChannelState(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM channel_state WHERE key = ?').get(key) as
      | RawRow
      | undefined
    return row ? String(row.value) : null
  }

  setChannelState(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO channel_state (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value)
  }

  // -------------------------------------------------------------------------
  // Users & targets (creator onboarding)
  // -------------------------------------------------------------------------

  upsertUser(user: { id: string; name: string; handle: string; createdAt: string }): void {
    this.db
      .prepare(
        `INSERT INTO users (id, name, handle, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, handle = excluded.handle`,
      )
      .run(user.id, user.name, user.handle, user.createdAt)
  }

  getUser(id: string): { id: string; name: string; handle: string; createdAt: string } | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as RawRow | undefined
    if (!row) return null
    return {
      id: String(row.id),
      name: String(row.name),
      handle: String(row.handle),
      createdAt: String(row.created_at),
    }
  }

  listUsers(): Array<{ id: string; name: string; handle: string; createdAt: string }> {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as RawRow[]
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      handle: String(r.handle),
      createdAt: String(r.created_at),
    }))
  }

  // -------------------------------------------------------------------------
  // Accounts (viewer login gate auth)
  // -------------------------------------------------------------------------

  /** Returns false when the email is already taken. */
  createAccount(a: {
    userId: string
    email: string
    passwordHash: string
    apiKey: string
    createdAt: string
  }): boolean {
    try {
      const result = this.db
        .prepare(
          `INSERT INTO accounts (user_id, email, password_hash, api_key, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(a.userId, a.email, a.passwordHash, a.apiKey, a.createdAt)
      return Number(result.changes) > 0
    } catch (error) {
      // UNIQUE email violation surfaces as a throw from sqlite.
      if (String(error).includes('UNIQUE')) return false
      throw error
    }
  }

  getAccountByEmail(email: string): {
    userId: string
    email: string
    passwordHash: string
    apiKey: string
    createdAt: string
  } | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE email = ?').get(email) as RawRow | undefined
    if (!row) return null
    return this.rowToAccount(row)
  }

  getAccountByApiKey(apiKey: string): {
    userId: string
    email: string
    apiKey: string
    createdAt: string
  } | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE api_key = ?').get(apiKey) as RawRow | undefined
    if (!row) return null
    return this.rowToAccount(row)
  }

  setAccountKey(userId: string, apiKey: string): void {
    this.db.prepare('UPDATE accounts SET api_key = ? WHERE user_id = ?').run(apiKey, userId)
  }

  deleteAccount(userId: string): void {
    this.db.prepare('DELETE FROM accounts WHERE user_id = ?').run(userId)
  }

  private rowToAccount(r: RawRow): {
    userId: string
    email: string
    passwordHash: string
    apiKey: string
    createdAt: string
  } {
    return {
      userId: String(r.user_id),
      email: String(r.email),
      passwordHash: String(r.password_hash),
      apiKey: String(r.api_key),
      createdAt: String(r.created_at),
    }
  }

  addTarget(target: {
    id: string
    userId: string
    platform: string
    kind: string
    value: string
    createdAt: string
  }): void {
    this.db
      .prepare(
        `INSERT INTO targets (id, user_id, platform, kind, value, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(target.id, target.userId, target.platform, target.kind, target.value, target.createdAt)
  }

  listTargets(userId?: string): Array<{
    id: string
    userId: string
    platform: string
    kind: string
    value: string
    createdAt: string
  }> {
    const rows: RawRow[] =
      userId === undefined
        ? (this.db.prepare('SELECT * FROM targets ORDER BY created_at ASC').all() as RawRow[])
        : (this.db
            .prepare('SELECT * FROM targets WHERE user_id = ? ORDER BY created_at ASC')
            .all(userId) as RawRow[])
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      platform: String(r.platform),
      kind: String(r.kind),
      value: String(r.value),
      createdAt: String(r.created_at),
    }))
  }

  removeTarget(id: string): boolean {
    const result = this.db.prepare('DELETE FROM targets WHERE id = ?').run(id)
    return Number(result.changes) > 0
  }

  // -------------------------------------------------------------------------
  // Settings (per-user key/value, e.g. the Telegram push config)
  // -------------------------------------------------------------------------

  setSetting(userId: string, key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(userId, key, value, new Date().toISOString())
  }

  getSetting(userId: string, key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?')
      .get(userId, key) as RawRow | undefined
    return row ? String(row.value) : null
  }

  deleteSetting(userId: string, key: string): boolean {
    const result = this.db
      .prepare('DELETE FROM settings WHERE user_id = ? AND key = ?')
      .run(userId, key)
    return Number(result.changes) > 0
  }

  listSettings(userId: string): Record<string, string> {
    const rows = this.db
      .prepare('SELECT key, value FROM settings WHERE user_id = ?')
      .all(userId) as RawRow[]
    const out: Record<string, string> = {}
    for (const row of rows) out[String(row.key)] = String(row.value)
    return out
  }

  // -------------------------------------------------------------------------
  // Videos (title cache so the viewer can show where each signal came from)
  // -------------------------------------------------------------------------

  upsertVideo(video: { videoId: string; platform: string; title: string; url: string }): void {
    this.db
      .prepare(
        `INSERT INTO videos (video_id, platform, title, url, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET title = excluded.title, url = excluded.url, updated_at = excluded.updated_at`,
      )
      .run(video.videoId, video.platform, video.title, video.url, new Date().toISOString())
  }

  listVideos(): Array<{ videoId: string; platform: string; title: string; url: string }> {
    const rows = this.db.prepare('SELECT * FROM videos ORDER BY updated_at DESC').all() as RawRow[]
    return rows.map((r) => ({
      videoId: String(r.video_id),
      platform: String(r.platform),
      title: String(r.title),
      url: String(r.url),
    }))
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  stats(): Record<string, number> {
    const tables = [
      'comments',
      'signals',
      'opportunities',
      'fans',
      'decisions',
      'creator_memory',
      'digests',
      'targets',
    ] as const
    const out: Record<string, number> = {}
    for (const table of tables) {
      const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as RawRow
      out[table] = Number(row.n)
    }
    return out
  }

  reset(): void {
    this.db.exec(
      `DELETE FROM comments; DELETE FROM signals; DELETE FROM opportunities;
       DELETE FROM fans; DELETE FROM decisions; DELETE FROM creator_memory;
       DELETE FROM digests; DELETE FROM channel_state;`,
    )
  }
}
