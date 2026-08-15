// CreatorSignal viewer. Pure client, talks only to the backend API.
// Reads the API token from localStorage (set once) and sends it as a Bearer
// header. Handles the onboarding flow (profile + connected targets) and the
// live dashboard. No business logic lives here.

const TOKEN_KEY = 'creatorsignal-token'

function apiUrl(path) {
  return `/api${path}`
}

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) }
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) headers.authorization = `Bearer ${token}`
  const response = await fetch(apiUrl(path), { ...options, headers })
  if (!response.ok) {
    if (response.status === 401 && !token) {
      // Prompt once for the API token, then retry.
      const entered = prompt('Enter the CreatorSignal API token (see CREATORSIGNAL_API_TOKEN):')
      if (entered) {
        localStorage.setItem(TOKEN_KEY, entered)
        return api(path, options)
      }
    }
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
    if (o.status === 'open' || o.status === 'proposed') {
      const actions = el('div', 'actions')
      const approve = el('button', 'ok', 'Approve → make it')
      approve.onclick = () => decide(o.id, 'approved')
      const reject = el('button', 'no', 'Reject')
      reject.onclick = () => decide(o.id, 'rejected')
      actions.append(approve, reject)
      item.append(actions)
    }
    wrap.append(item)
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
  btn.disabled = true
  btn.textContent = 'Drafting…'
  try {
    const res = await api('/brief/generate', { method: 'POST' })
    renderBrief(res.brief)
  } catch (error) {
    console.error('brief generate failed', error)
  } finally {
    btn.disabled = false
    btn.textContent = 'Generate now'
  }
}

// ------------------------------------------------------------------- data

async function refresh() {
  // /health is intentionally public (auth-exempt) and lives outside /api.
  const health = await fetch('/health').then((r) => r.json())
  const [opportunities, fans, comments, digests] = await Promise.all([
    api('/opportunities'),
    api('/fans'),
    api('/comments?limit=200'),
    api('/digests?limit=5'),
  ])
  renderStats(health.stats)
  renderOpportunities(opportunities.opportunities)
  renderFans(fans.fans)
  renderComments(comments.comments)
  renderDigests(digests.digests)
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

document.addEventListener('DOMContentLoaded', () => {
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
  void loadBrief()
  void refresh()
})
