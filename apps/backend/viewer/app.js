// CreatorSignal viewer. Pure client, talks only to the backend API.
// Reads the API token from localStorage (set once) and sends it as a Bearer
// header. No business logic lives here.

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
      // Prompt once for the demo token, then retry.
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
  return el('span', `pill-sm ${meta.dot}`, meta.label)
}

// ------------------------------------------------------------------ render

function renderStats(stats) {
  document.getElementById('stat-comments').textContent = stats.comments ?? '–'
  document.getElementById('stat-opportunities').textContent = stats.opportunities ?? '–'
  document.getElementById('stat-fans').textContent = stats.fans ?? '–'
  document.getElementById('stat-digests').textContent = stats.digests ?? '–'
}

function renderPlatformBars(signals) {
  const counts = { youtube: 0, tiktok: 0, x: 0 }
  for (const s of signals) if (counts[s.platform] !== undefined) counts[s.platform]++
  const wrap = document.getElementById('platform-bars')
  wrap.innerHTML = ''
  for (const [platform, count] of Object.entries(counts)) {
    const meta = PLATFORM_META[platform]
    const box = el('div', 'pf')
    box.append(el('span', `dot ${meta.dot}`), el('span', '', meta.label), el('span', 'count', String(count)))
    wrap.append(box)
  }
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

// ------------------------------------------------------------------- data

async function refresh() {
  const [health, opportunities, fans, comments, digests] = await Promise.all([
    api('/health'),
    api('/opportunities'),
    api('/fans'),
    api('/comments?limit=200'),
    api('/digests?limit=5'),
  ])
  renderStats(health.stats)
  renderPlatformBars(comments.comments)
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
  document.getElementById('run-pipeline').onclick = runPipeline
  document.getElementById('platform-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip')
    if (!btn) return
    currentPlatform = btn.dataset.platform
    for (const chip of document.querySelectorAll('.chip')) chip.classList.toggle('active', chip === btn)
    void refresh()
  })
  void refresh()
})
