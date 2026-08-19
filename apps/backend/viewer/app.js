// CreatorSignal viewer. Pure client, talks only to the backend API.
// Reads the API token from localStorage (set once) and sends it as a Bearer
// header. Handles the onboarding flow (profile + connected targets) and the
// live dashboard. No business logic lives here.

const TOKEN_KEY = 'creatorsignal-token'

function apiUrl(path) {
  return `/api${path}`
}

async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) }
  if (options.body) headers['content-type'] = 'application/json'
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) headers.authorization = `Bearer ${token}`
  const response = await fetch(apiUrl(path), { ...options, headers })
  if (!response.ok) {
    if (response.status === 401) showAuth()
    throw new Error(`API ${path}: ${response.status}`)
  }
  return response.json()
}

const PLATFORM_META = {
  youtube: { label: 'YouTube', dot: 'youtube' },
  tiktok: { label: 'TikTok', dot: 'tiktok' },
  x: { label: 'X', dot: 'x' },
  telegram: { label: 'Telegram', dot: 'telegram' },
}

// Guess the target kind from what the creator pasted.
const KIND_HINTS = {
  youtube: (value) => (/watch\?v=|youtu\.be\//.test(value) ? 'video' : 'channel'),
  tiktok: () => 'video',
  x: (value) => (/^\s*@/.test(value) ? 'user' : 'query'),
}

let currentPlatform = 'all'

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function platformPill(platform) {
  const meta = PLATFORM_META[platform] ?? { label: platform, dot: 'youtube' }
  const pill = el('span', `pill-sm platform-pill ${meta.dot}`)
  pill.append(el('span', `dot ${meta.dot}`), el('span', '', meta.label))
  return pill
}

// --------------------------------------------------------------- onboarding

function renderTargets(targets) {
  for (const platform of Object.keys(PLATFORM_META)) {
    const wrap = document.querySelector(`[data-target-list="${platform}"]`)
    if (!wrap) continue
    wrap.innerHTML = ''
    const mine = targets.filter((t) => t.platform === platform)
    if (!mine.length) continue
    for (const t of mine) {
      const chip = el('div', 'tchip')
      const left = el('span', '', t.value)
      const kind = el('span', 'kind', t.kind)
      const remove = el('button', 'x', '✕')
      remove.title = 'Disconnect'
      remove.onclick = async () => {
        try {
          const res = await api(`/targets/${t.id}`, { method: 'DELETE' })
          renderTargets(res.targets)
        } catch (error) {
          console.error('remove target failed', error)
        }
      }
      const inner = el('span', '', '')
      inner.append(kind, left)
      chip.append(inner, remove)
      wrap.append(chip)
    }
  }
}

function bindOnboarding() {
  document.getElementById('save-profile').onclick = async () => {
    const name = document.getElementById('profile-name').value.trim()
    const handle = document.getElementById('profile-handle').value.trim()
    if (!name || !handle) return
    try {
      const res = await api('/profile', { method: 'POST', body: JSON.stringify({ name, handle }) })
      renderTargets(res.targets)
      document.getElementById('save-profile').textContent = 'Saved ✓'
      setTimeout(() => {
        document.getElementById('save-profile').textContent = 'Save profile'
      }, 1600)
    } catch (error) {
      console.error('save profile failed', error)
    }
  }

  for (const [platform, guess] of Object.entries(KIND_HINTS)) {
    const addBtn = document.querySelector(`[data-target-add="${platform}"]`)
    const input = document.querySelector(`[data-target-input="${platform}"]`)
    if (!addBtn || !input) continue
    const doAdd = async () => {
      const value = input.value.trim()
      if (!value) return
      const kind = guess(value)
      addBtn.disabled = true
      try {
        const res = await api('/targets', {
          method: 'POST',
          body: JSON.stringify({ platform, kind, value }),
        })
        input.value = ''
        renderTargets(res.targets)
      } catch (error) {
        console.error('add target failed', error)
      } finally {
        addBtn.disabled = false
      }
    }
    addBtn.onclick = doAdd
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doAdd()
    })
  }

  bindTelegramBot()
  bindWebhook()
}

// ---------------------------------------------------------------- login gate

function setAuthMode(mode) {
  const register = mode === 'register'
  document.getElementById('reg-name-wrap').hidden = !register
  document.getElementById('reg-handle-wrap').hidden = !register
  document.getElementById('auth-submit').textContent = register ? 'Create account' : 'Log in'
  document.getElementById('tab-login').classList.toggle('active', !register)
  document.getElementById('tab-register').classList.toggle('active', register)
}

function showAuth() {
  const overlay = document.getElementById('auth-overlay')
  if (overlay) overlay.hidden = false
  const logout = document.getElementById('logout')
  const name = document.getElementById('auth-name')
  if (logout) logout.hidden = true
  if (name) name.hidden = true
  setAuthMode('login')
}

function bindAuth() {
  document.getElementById('tab-login').onclick = () => setAuthMode('login')
  document.getElementById('tab-register').onclick = () => setAuthMode('register')
  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const registerMode = !document.getElementById('reg-name-wrap').hidden
    const email = document.getElementById('auth-email').value.trim()
    const password = document.getElementById('auth-pass').value
    const err = document.getElementById('auth-err')
    const submit = document.getElementById('auth-submit')
    err.textContent = ''
    submit.disabled = true
    try {
      let response
      if (registerMode) {
        const name = document.getElementById('auth-name-in').value.trim()
        const handle = document.getElementById('auth-handle').value.trim()
        response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password, name, handle }),
        })
      } else {
        response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
      }
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        err.textContent = registerMode
          ? 'Could not create account — try a different email.'
          : 'Invalid email or password.'
        return
      }
      localStorage.setItem(TOKEN_KEY, data.token)
      document.getElementById('auth-name').textContent = `👤 ${data.user.name}`
      document.getElementById('auth-name').hidden = false
      document.getElementById('logout').hidden = false
      document.getElementById('auth-overlay').hidden = true
      await boot()
    } catch (error) {
      err.textContent = 'Network error — try again.'
    } finally {
      submit.disabled = false
    }
  })
  document.getElementById('logout').onclick = async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token) {
      try {
        await fetch('/api/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } })
      } catch (error) {
        console.error('logout failed', error)
      }
    }
    localStorage.removeItem(TOKEN_KEY)
    showAuth()
    window.location.reload()
  }
}

async function initAuth() {
  let health
  try {
    health = await fetch('/health').then((r) => r.json())
  } catch {
    health = null
  }
  const googleAuth = document.getElementById('google-auth')
  if (googleAuth) googleAuth.hidden = !(health && health.google)
  if (!health || health.auth !== true) {
    // Auth off (or /health unreachable) — open dashboard.
    await boot()
    return
  }
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    try {
      const res = await fetch('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })
      if (res.ok) {
        const me = await res.json()
        document.getElementById('auth-name').textContent = `👤 ${me.user.name}`
        document.getElementById('auth-name').hidden = false
        document.getElementById('logout').hidden = false
        document.getElementById('auth-overlay').hidden = true
        await boot()
        return
      }
    } catch (error) {
      console.error('auth check failed', error)
    }
    localStorage.removeItem(TOKEN_KEY)
  }
  showAuth()
}

// ------------------------------------------------------------- webhook digest

function renderWebhookStatus(status) {
  const box = document.getElementById('wh-status')
  if (!box) return
  if (!status.enabled) {
    box.innerHTML = ''
    box.classList.remove('on')
    return
  }
  const disconnect = document.createElement('button')
  disconnect.className = 'linklike'
  disconnect.textContent = 'Disconnect'
  disconnect.onclick = async () => {
    try {
      const res = await api('/settings/webhook', { method: 'DELETE' })
      renderWebhookStatus(res)
    } catch (error) {
      console.error('webhook disconnect failed', error)
    }
  }
  box.classList.add('on')
  box.textContent = `✅ Connected · ${status.urlMasked} · `
  box.append(disconnect)
}

function bindWebhook() {
  const connect = document.getElementById('wh-connect')
  if (!connect) return
  connect.onclick = async () => {
    const url = document.getElementById('wh-url').value.trim()
    if (!url) return
    connect.disabled = true
    const status = document.getElementById('wh-status')
    status.textContent = 'Connecting…'
    try {
      const res = await api('/settings/webhook', { method: 'POST', body: JSON.stringify({ url }) })
      document.getElementById('wh-url').value = ''
      renderWebhookStatus(res)
    } catch (error) {
      status.textContent = '❌ could not connect'
    } finally {
      connect.disabled = false
    }
  }
}

async function loadWebhookStatus() {
  try {
    const res = await api('/settings/webhook')
    renderWebhookStatus(res)
  } catch (error) {
    console.error('webhook status load failed', error)
  }
}

function renderTelegramStatus(status) {
  const box = document.getElementById('tg-status')
  if (!box) return
  if (!status.enabled) {
    box.innerHTML = ''
    box.classList.remove('on')
    return
  }
  const name = status.botName ? `@${status.botName}` : 'bot'
  const target = status.chatTitle || status.groupIdMasked || 'group'
  const disconnect = document.createElement('button')
  disconnect.className = 'linklike'
  disconnect.textContent = 'Disconnect'
  disconnect.onclick = async () => {
    try {
      const res = await api('/settings/telegram', { method: 'DELETE' })
      renderTelegramStatus(res)
      box.innerHTML = ''
      box.classList.remove('on')
    } catch (error) {
      console.error('telegram disconnect failed', error)
    }
  }
  box.classList.add('on')
  box.textContent = `✅ Connected · ${name} → ${target} · `
  box.append(disconnect)
}

function bindTelegramBot() {
  const connect = document.getElementById('tg-connect')
  const status = document.getElementById('tg-status')
  if (!connect || !status) return
  connect.onclick = async () => {
    const botToken = document.getElementById('tg-token').value.trim()
    const groupId = document.getElementById('tg-group').value.trim()
    if (!botToken || !groupId) return
    connect.disabled = true
    status.textContent = 'Connecting…'
    try {
      const res = await api('/settings/telegram', {
        method: 'POST',
        body: JSON.stringify({ botToken, groupId }),
      })
      document.getElementById('tg-token').value = ''
      document.getElementById('tg-group').value = ''
      renderTelegramStatus(res)
    } catch (error) {
      status.textContent = `❌ ${error instanceof Error ? error.message : 'connect failed'}`
    } finally {
      connect.disabled = false
    }
  }
  const tokenField = document.getElementById('tg-token')
  tokenField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connect.onclick()
  })
  document.getElementById('tg-group').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connect.onclick()
  })
}

async function loadTelegramStatus() {
  try {
    const res = await api('/settings/telegram')
    renderTelegramStatus(res)
  } catch (error) {
    console.error('telegram status load failed', error)
  }
}

async function loadOnboarding() {
  const res = await api('/profile')
  if (res.user) {
    document.getElementById('profile-name').value = res.user.name
    document.getElementById('profile-handle').value = res.user.handle
  }
  renderTargets(res.targets)
}

// ------------------------------------------------------------------ render

function renderStats(stats) {
  document.getElementById('stat-comments').textContent = stats.comments ?? '–'
  document.getElementById('stat-opportunities').textContent = stats.opportunities ?? '–'
  document.getElementById('stat-fans').textContent = stats.fans ?? '–'
  document.getElementById('stat-digests').textContent = stats.digests ?? '–'
}

function renderOpportunities(opportunities) {
  const wrap = document.getElementById('opportunities')
  wrap.innerHTML = ''
  if (!opportunities.length) {
    wrap.append(el('div', 'empty', 'No opportunities yet. Run the pipeline.'))
    return
  }
  for (const o of opportunities) {
    const item = el('div', 'item')
    const row = el('div', 'row')
    row.append(
      el('span', 'score', String(o.demandScore)),
      el('span', 'title', o.topicLabel),
      el('span', `pill-sm ${o.status}`, o.status),
    )
    item.append(row)
    item.append(
      el('div', 'sub', `${o.repeatCount} repeats · ${o.videoCount} videos · ${o.unanswered ? 'unanswered' : 'answered'}`),
    )
    if (o.relatedAuthors?.length) {
      item.append(
        el('div', 'sub', `asked by: ${o.relatedAuthors.map((a) => a.name).join(', ')}`),
      )
    }
    const detail = el('div', 'opp-detail')
    detail.hidden = true
    const meta = el('div', 'opp-meta')
    meta.append(
      el('span', '', `demand ${o.demandScore}`),
      el('span', '', `${o.repeatCount} repeats`),
      el('span', '', `${o.videoCount} videos`),
      el('span', '', o.unanswered ? 'unanswered' : 'answered'),
      el('span', '', `last seen ${new Date(o.lastSeenAt).toLocaleDateString()}`),
    )
    detail.append(meta)
    detail.append(el('div', 'opp-evidence'))
    item.append(detail)
    const actions = el('div', 'actions')
    const openBtn = el('button', 'ok', 'Open')
    openBtn.title = 'Show the evidence behind this opportunity'
    openBtn.onclick = () => toggleOpen(o, detail, openBtn)
    actions.append(openBtn)
    const draftBtn = el('button', '', '💬 draft reply')
    draftBtn.title = 'Draft a reply to the fan asking for this'
    draftBtn.onclick = async () => {
      try {
        const res = await api('/reply-draft', { method: 'POST', body: JSON.stringify({ opportunityId: o.id }) })
        draftBtn.textContent = '✓ drafted'
        void loadDrafts()
        const show = el('div', 'text', `📝 ${res.draft}`)
        item.append(show)
      } catch (error) {
        console.error('draft reply failed', error)
      }
    }
    actions.append(draftBtn)
    if (o.status === 'open' || o.status === 'proposed') {
      const approve = el('button', 'ok', 'Approve → make it')
      approve.onclick = () => decide(o.id, 'approved')
      const reject = el('button', 'no', 'Reject')
      reject.onclick = () => decide(o.id, 'rejected')
      actions.append(approve, reject)
    }
    item.append(actions)
    wrap.append(item)
  }
}

// Cache evidence per topic so toggling open/close is instant after first load.
const evidenceCache = new Map()

async function toggleOpen(o, detail, btn) {
  const opening = detail.hidden
  detail.hidden = !opening
  btn.textContent = opening ? 'Close' : 'Open'
  if (!opening) return
  const box = detail.querySelector('.opp-evidence')
  box.innerHTML = '<div class="empty">Loading evidence…</div>'
  try {
    let signals
    if (evidenceCache.has(o.topic)) {
      signals = evidenceCache.get(o.topic)
    } else {
      const res = await api(`/signals?topic=${encodeURIComponent(o.topic)}&limit=100`)
      signals = res.signals ?? []
      evidenceCache.set(o.topic, signals)
    }
    renderEvidence(box, signals)
  } catch (error) {
    box.innerHTML = '<div class="empty">Could not load evidence.</div>'
    console.error('evidence load failed', error)
  }
}

function renderEvidence(box, signals) {
  if (!signals.length) {
    box.innerHTML = '<div class="empty">No raw signals for this topic yet.</div>'
    return
  }
  box.innerHTML = ''
  for (const s of signals) {
    const ev = el('div', 'ev')
    const meta = el('div', 'ev-meta')
    meta.append(platformPill(s.platform), el('span', `pill-sm ${s.kind}`, s.kind), el('span', 'ev-author', s.authorName))
    ev.append(meta)
    if (s.videoTitle) {
      const vlink = el('a', 'vid', `📺 ${s.videoTitle}`)
      vlink.href = s.videoUrl || '#'
      vlink.target = '_blank'
      vlink.rel = 'noopener'
      ev.append(vlink)
    }
    ev.append(el('div', 'ev-text', s.text))
    box.append(ev)
  }
}

async function decide(id, decision) {
  const note = decision === 'approved' ? 'creator approved' : 'creator rejected'
  await api(`/opportunities/${id}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision, note }),
  })
  await refresh()
}

function renderFans(fans) {
  const wrap = document.getElementById('fans')
  wrap.innerHTML = ''
  if (!fans.length) {
    wrap.append(el('div', 'empty', 'No fans tracked yet.'))
    return
  }
  for (const f of fans) {
    const item = el('div', 'item')
    const row = el('div', 'row')
    row.append(el('span', 'score', String(f.superfanScore)), el('span', 'title', f.name))
    item.append(row)
    item.append(
      el('div', 'sub', `${f.engagementCount} engagements · ${f.questionCount} questions`),
    )
    const draftBtn = el('button', '', '✍️ draft a reply')
    draftBtn.onclick = async () => {
      const res = await api('/reply-draft', { method: 'POST', body: JSON.stringify({ fanId: f.authorId }) })
      const draftEl = el('div', 'text', `📝 ${res.draft}`)
      item.append(draftEl)
      draftBtn.remove()
      void loadDrafts()
    }
    const actions = el('div', 'actions')
    actions.append(draftBtn)
    item.append(actions)
    wrap.append(item)
  }
}

function renderComments(comments) {
  const wrap = document.getElementById('comments')
  wrap.innerHTML = ''
  const visible = currentPlatform === 'all' ? comments : comments.filter((c) => c.platform === currentPlatform)
  if (!visible.length) {
    wrap.append(el('div', 'empty', 'No signals on this platform yet.'))
    return
  }
  for (const c of visible.slice(0, 60)) {
    const item = el('div', 'item')
    const row = el('div', 'row')
    row.append(platformPill(c.platform), el('span', '', c.authorName), el('span', `pill-sm ${c.kind}`, c.kind))
    item.append(row)
    if (c.videoTitle) {
      const vlink = el('a', 'vid', `📺 ${c.videoTitle}`)
      vlink.href = c.videoUrl || '#'
      vlink.target = '_blank'
      vlink.rel = 'noopener'
      item.append(vlink)
    }
    item.append(el('div', 'text', c.text))
    wrap.append(item)
  }
}

function renderDigests(digests) {
  const wrap = document.getElementById('digests')
  wrap.innerHTML = ''
  if (!digests.length) {
    wrap.append(el('div', 'empty', 'No digests yet.'))
    return
  }
  for (const d of digests.slice(0, 3)) {
    const item = el('div', 'item')
    item.append(el('div', 'sub', new Date(d.createdAt).toLocaleString()))
    for (const it of d.items.slice(0, 6)) {
      const row = el('div', 'digest-item')
      const emoji = it.type === 'opportunity' ? '🎯' : it.type === 'fan' ? '⭐' : '🔔'
      row.append(el('span', 'emoji', emoji), el('span', '', it.text))
      item.append(row)
    }
    wrap.append(item)
  }
}

function renderBrief(brief) {
  const wrap = document.getElementById('brief')
  wrap.innerHTML = ''
  if (!brief) {
    wrap.append(el('div', 'empty', 'No brief yet — generate one or wait for the weekly push.'))
    return
  }
  const head = el('div', 'item')
  head.append(el('div', 'sub', `For ${brief.period} · generated ${new Date(brief.generatedAt).toLocaleDateString()}`))
  head.append(el('div', 'text', brief.headline))
  wrap.append(head)
  for (const item of brief.items) {
    const card = el('div', 'item')
    const row = el('div', 'row')
    row.append(el('span', '', `#${item.topicLabel}`), el('span', `pill-sm demand`, `${Math.round(item.demandScore)}`))
    card.append(row)
    const meta = el('div', 'sub', `${item.repeatCount} repeats · ${item.videoCount} videos${item.askers.length ? ` · asked by ${item.askers.join(', ')}` : ''}`)
    card.append(meta)
    card.append(el('div', 'text', item.angle))
    wrap.append(card)
  }
}

async function loadBrief() {
  try {
    const res = await api('/brief/latest')
    renderBrief(res.brief)
  } catch (error) {
    console.error('brief load failed', error)
  }
}

async function generateBrief() {
  const btn = document.getElementById('generate-brief')
  const ack = document.getElementById('brief-ack')
  btn.disabled = true
  btn.textContent = 'Drafting…'
  if (ack) ack.textContent = ''
  try {
    const res = await api('/brief/generate', { method: 'POST' })
    renderBrief(res.brief)
    if (ack) ack.textContent = `✓ Brief regenerated ${new Date().toLocaleTimeString()}`
  } catch (error) {
    console.error('brief generate failed', error)
    if (ack) ack.textContent = '❌ Generate failed — try again'
  } finally {
    btn.disabled = false
    btn.textContent = 'Generate now'
  }
}

// ------------------------------------------------------------------- data

function renderDrafts(drafts) {
  const wrap = document.getElementById('drafts')
  wrap.innerHTML = ''
  if (!drafts.length) {
    wrap.append(el('div', 'empty', 'No drafts yet — hit "draft a reply" on a fan or an opportunity.'))
    return
  }
  for (const d of drafts) {
    const item = el('div', 'item')
    const ctx = d.opportunity ? `🎯 ${d.opportunity.topicLabel}` : d.fan ? `⭐ ${d.fan.name}` : 'reply draft'
    item.append(el('div', 'sub', ctx))
    item.append(el('div', 'text', d.content))
    const copy = document.createElement('button')
    copy.className = 'linklike'
    copy.textContent = 'Copy'
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(d.content)
        copy.textContent = 'Copied ✓'
      } catch {
        const ta = document.createElement('textarea')
        ta.value = d.content
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
        copy.textContent = 'Copied ✓'
      }
      setTimeout(() => (copy.textContent = 'Copy'), 1400)
    }
    const actions = el('div', 'actions')
    actions.append(copy)
    item.append(actions)
    wrap.append(item)
  }
}

async function loadDrafts() {
  try {
    const res = await api('/drafts')
    renderDrafts(res.drafts)
  } catch (error) {
    console.error('drafts load failed', error)
  }
}

async function refresh() {
  // /health is intentionally public (auth-exempt) and lives outside /api.
  const health = await fetch('/health').then((r) => r.json())
  const [opportunities, fans, comments, digests, drafts] = await Promise.all([
    api('/opportunities'),
    api('/fans'),
    api('/comments?limit=200'),
    api('/digests?limit=5'),
    api('/drafts'),
  ])
  renderStats(health.stats)
  renderOpportunities(opportunities.opportunities)
  renderFans(fans.fans)
  renderComments(comments.comments)
  renderDigests(digests.digests)
  renderDrafts(drafts.drafts)
  document.getElementById('mind-mode').textContent = `mind: ${health.mindMode}`
}

async function runPipeline() {
  const btn = document.getElementById('run-pipeline')
  btn.disabled = true
  btn.textContent = 'Running…'
  try {
    await api('/pipeline/run', { method: 'POST', body: JSON.stringify({ stages: ['ingest', 'distill', 'relay'] }) })
    await refresh()
  } finally {
    btn.disabled = false
    btn.textContent = 'Run pipeline'
  }
}

async function boot() {
  bindOnboarding()
  document.getElementById('run-pipeline').onclick = runPipeline
  document.getElementById('generate-brief').onclick = generateBrief
  document.getElementById('platform-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip')
    if (!btn) return
    currentPlatform = btn.dataset.platform
    for (const chip of document.querySelectorAll('.chip')) chip.classList.toggle('active', chip === btn)
    void refresh()
  })
  void loadOnboarding()
  void loadTelegramStatus()
  void loadWebhookStatus()
  void loadBrief()
  void refresh()
}

function handleDeepLinkAuth() {
  // Google OAuth returns here with ?google_token= or ?google_error=.
  const params = new URLSearchParams(window.location.search)
  const token = params.get('google_token')
  const error = params.get('google_error')
  const clean = () => {
    const base = window.location.pathname
    let search = window.location.search
      .replace(/[?&]google_token=[^&]*/, '')
      .replace(/[?&]google_error=[^&]*/, '')
      .replace(/^&/, '?')
      .replace(/^\?$/, '')
    history.replaceState(null, '', base + search)
  }
  if (error) {
    clean()
    document.addEventListener('DOMContentLoaded', () => {
      showAuth()
      const e = document.getElementById('auth-err')
      if (e) e.textContent = 'Google sign-in failed — try again or use email.'
    })
  }
  if (token) {
    localStorage.setItem(TOKEN_KEY, token)
    clean()
    window.location.reload()
  }
}

document.addEventListener('DOMContentLoaded', () => {
  handleDeepLinkAuth()
  bindAuth()
  void initAuth()
})
