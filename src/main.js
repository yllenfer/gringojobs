import './style.css'
import { fetchJobsFromApify, normalizeJob, getCachedJobs, clearCache } from './api.js'

const state = { jobs: [], filtered: [], loading: false, lastCached: null }

const $ = s => document.querySelector(s)
const $$ = s => document.querySelectorAll(s)

const $grid = $('#jobsGrid')
const $count = $('#resultsCount')
const $searchInput = $('#searchInput')
const $refreshBtn = $('#refreshJobsBtn')
const $workTypeChips = $$('#workTypeFilter .chip')
const $expFilter = $('#expFilter')
const $locationFilter = $('#locationFilter')
const $sortFilter = $('#sortFilter')
const $clearFilters = $('#clearFiltersBtn')

init()

function init() {
  bindEvents()
  loadJobs()
}

function bindEvents() {
  $refreshBtn.addEventListener('click', () => {
    clearCache()
    $count.textContent = 'Refreshing jobs...'
    fetchJobs(true)
  })
  $searchInput.addEventListener('input', debounce(applyFilters, 300))
  $workTypeChips.forEach(c => c.addEventListener('click', e => {
    $workTypeChips.forEach(x => x.classList.remove('active'))
    e.currentTarget.classList.add('active')
    applyFilters()
  }))
  $expFilter.addEventListener('change', applyFilters)
  $locationFilter.addEventListener('input', debounce(applyFilters, 300))
  $sortFilter.addEventListener('change', applyFilters)
  $clearFilters.addEventListener('click', clearFilters)

  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault()
      const id = a.getAttribute('href').slice(1)
      const el = document.getElementById(id)
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY - 120
        window.scrollTo({ top, behavior: 'smooth' })
      }
    })
  })
}

function loadJobs() {
  const cached = getCachedJobs()
  if (cached && cached.length) {
    state.jobs = cached.map(normalizeJob)
    state.lastCached = Date.now()
    applyFilters()
  } else {
    $count.textContent = 'Loading jobs...'
  }
  fetchJobs(false)
}

async function fetchJobs(force) {
  setLoading(true)
  try {
    const raw = await fetchJobsFromApify({
      titleSearch: $searchInput.value.trim() || undefined,
      locationSearch: $locationFilter.value.trim() || undefined,
      forceRefresh: force,
    })
    state.jobs = raw.map(normalizeJob)
    state.lastCached = Date.now()
    applyFilters()
  } catch (err) {
    if (!state.jobs.length) {
      $count.textContent = 'Could not load jobs'
      $grid.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 8l8 8M16 8l-8 8"/></svg>
          <h3>Failed to load jobs</h3>
          <p>${escHtml(err.message)}</p>
        </div>`
    } else {
      showToast('Failed to refresh jobs', 'error')
    }
  } finally {
    setLoading(false)
  }
}

function applyFilters() {
  const query = $searchInput.value.toLowerCase().trim()
  const workType = document.querySelector('#workTypeFilter .chip.active')?.dataset.value || ''
  const exp = $expFilter.value
  const locQ = $locationFilter.value.toLowerCase().trim()
  const sort = $sortFilter.value

  let filtered = state.jobs.filter(j => {
    if (query && !matches(j, query)) return false
    if (workType && j.workType !== workType) return false
    if (exp && j.experienceLevel !== exp) return false
    if (locQ && !locMatch(j, locQ)) return false
    return true
  })

  if (sort === 'salary_high') filtered.sort((a, b) => (b.salaryMin || 0) - (a.salaryMin || 0))
  else if (sort === 'salary_low') filtered.sort((a, b) => (a.salaryMin || 0) - (b.salaryMin || 0))
  else filtered.sort((a, b) => new Date(b.datePosted) - new Date(a.datePosted))

  state.filtered = filtered
  render()
}

function matches(j, q) {
  return [j.title, j.organization, j.description, j.salary].some(f => f?.toLowerCase().includes(q))
}

function locMatch(j, q) {
  return [j.location, ...j.cities, ...j.regions, ...j.countries].some(f => f?.toLowerCase().includes(q))
}

function clearFilters() {
  $searchInput.value = ''
  $workTypeChips.forEach(c => c.classList.toggle('active', c.dataset.value === ''))
  $expFilter.value = ''
  $locationFilter.value = ''
  $sortFilter.value = 'newest'
  applyFilters()
}

function setLoading(v) {
  state.loading = v
  $refreshBtn.disabled = v
  $refreshBtn.textContent = v ? 'Refreshing...' : 'Refresh Jobs'
}

function render() {
  const jobs = state.filtered
  const total = state.jobs.length
  const cachedLabel = state.lastCached
    ? ` (cached ${fmtDate(state.lastCached).toLowerCase()})`
    : ''
  $count.textContent = `${jobs.length} job${jobs.length !== 1 ? 's' : ''} found of ${total}${cachedLabel}`
  if (!jobs.length) {
    $grid.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/></svg>
        <h3>No jobs match your filters</h3>
        <p>Try adjusting your search or clear filters</p>
      </div>`
    return
  }
  $grid.innerHTML = jobs.map(renderCard).join('')
}

function renderCard(j) {
  const logo = j.logo
    ? `<img class="job-card-logo" src="${j.logo}" alt="${j.organization}" loading="lazy" onerror="this.remove()">`
    : `<div class="job-card-logo-placeholder">${j.organization.charAt(0)}</div>`

  return `
    <div class="job-card">
      <div class="job-card-header">
        ${logo}
        <div class="job-card-info">
          <div class="job-card-title">${escHtml(j.title)}</div>
          <div class="job-card-company">${escHtml(j.organization)}</div>
        </div>
      </div>
      <div class="job-card-meta">
        <span class="meta-tag ${j.workTypeClass}">${escHtml(j.workType)}</span>
        <span class="meta-tag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${escHtml(j.location) || 'Remote'}</span>
        ${j.employmentType ? `<span class="meta-tag">${escHtml(j.employmentType)}</span>` : ''}
        ${j.salary ? `<span class="meta-tag salary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>${escHtml(j.salary)}</span>` : ''}
      </div>
      <div class="job-card-desc">${escHtml(j.description)}</div>
      <div class="job-card-footer">
        <span class="job-card-date">${fmtDate(j.datePosted)}</span>
        <a class="job-card-apply" href="${j.url}" target="_blank" rel="noopener">Apply →</a>
      </div>
    </div>`
}

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s), n = new Date()
  const diff = n - d
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function showToast(msg, type) {
  const existing = $('.toast')
  if (existing) existing.remove()
  const el = document.createElement('div')
  el.className = `toast ${type}`
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 4000)
}

function escHtml(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML }

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } }
