const CACHE_KEY = 'gringojobs_cache'
const CACHE_EXPIRY = 6 * 60 * 60 * 1000 // 6 hours

export function getCachedJobs() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { jobs, timestamp } = JSON.parse(raw)
    if (Date.now() - timestamp > CACHE_EXPIRY) {
      localStorage.removeItem(CACHE_KEY)
      return null
    }
    return jobs
  } catch {
    return null
  }
}

export function setCachedJobs(jobs) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ jobs, timestamp: Date.now() }))
  } catch {}
}

export function clearCache() {
  localStorage.removeItem(CACHE_KEY)
}

export async function fetchJobsFromApify({ forceRefresh } = {}) {
  if (!forceRefresh) {
    const cached = getCachedJobs()
    if (cached) return cached
  }

  const jobs = import.meta.env.DEV ? await fetchDev() : await fetchProd()
  setCachedJobs(jobs)
  return jobs
}

async function fetchProd() {
  const res = await fetch(`${import.meta.env.BASE_URL}jobs.json`)
  if (!res.ok) throw new Error(`Failed to load jobs (${res.status})`)
  const data = await res.json()
  return Array.isArray(data) ? data : data.data || []
}

async function fetchDev() {
  const TOKEN = import.meta.env.VITE_APIFY_TOKEN
  const ACTOR_ID = import.meta.env.VITE_APIFY_ACTOR_ID || 'fantastic-jobs~career-site-job-listing-api'
  const res = await fetch(
    `/apify/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeRange: '7d',
        limit: 500,
        includeAi: true,
        descriptionType: 'text',
        populateAiRemoteLocation: false,
        populateAiRemoteLocationDerived: false,
      }),
    }
  )
  if (!res.ok) {
    console.warn('Apify API failed, falling back to jobs.json')
    return fetchProd()
  }
  const data = await res.json()
  return Array.isArray(data) ? data : data.data || []
}

export function normalizeJob(job) {
  const locs = job.locations_derived || []
  const locationStr = locs.map(l => [l.city, l.admin, l.country].filter(Boolean).join(', ')).filter(Boolean).join('; ')
    || (job.locations_raw || []).map(l => l.address?.addressLocality || '').filter(Boolean).join(', ')

  const minV = job.ai_salary_minvalue, maxV = job.ai_salary_maxvalue, cur = job.ai_salary_currency || 'USD'
  const salaryStr = minV || maxV ? `${minV ? fmtSalary(minV, cur) : ''}${minV && maxV ? ' - ' : ''}${maxV ? fmtSalary(maxV, cur) : ''}` : ''
  const salaryAnnual = job.ai_salary_unittext === 'HOUR' ? (minV || 0) * 2080 : (minV || 0)

  const wt = job.ai_work_arrangement || (job.remote_derived ? 'Remote Solely' : job.location_type === 'TELECOMMUTE' ? 'Remote Solely' : 'On-site')
  const wtClass = wt.toLowerCase().includes('remote') ? 'remote' : wt.toLowerCase().includes('hybrid') ? 'hybrid' : 'onsite'

  return {
    id: job.id || Math.random().toString(36).slice(2),
    title: job.title || 'Unknown Position',
    organization: job.organization || 'Unknown Company',
    logo: job.organization_logo || null,
    url: job.url || '#',
    location: locationStr || 'Remote',
    salary: salaryStr,
    salaryMin: salaryAnnual,
    workType: wt,
    workTypeClass: wtClass,
    employmentType: (job.ai_employment_type || job.employment_type || []).join(', ') || 'Full Time',
    experienceLevel: normalizeExp(job.ai_experience_level),
    description: (job.description_text || '').slice(0, 500),
    datePosted: job.date_posted || new Date().toISOString(),
    countries: job.countries_derived || [],
    cities: job.cities_derived || [],
    regions: job.regions_derived || [],
    remote: job.remote_derived || wt.toLowerCase().includes('remote'),
  }
}

function normalizeExp(raw) {
  if (!raw) return ''
  const v = raw.toLowerCase()
  if (v.includes('intern')) return 'Internship'
  if (v.includes('entry') || v.includes('junior')) return 'Entry Level'
  if (v.includes('associate') || v.includes('mid')) return 'Mid Level'
  if (v.includes('senior') || v.includes('sr')) return 'Senior Level'
  if (v.includes('lead') || v.includes('principal') || v.includes('staff')) return 'Lead'
  if (v.includes('director') || v.includes('manager') || v.includes('executive') || v.includes('vp')) return 'Manager+'
  return raw
}

function fmtSalary(v, c) {
  if (v >= 1000) return `${c} ${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`
  return `${c} ${v}`
}
