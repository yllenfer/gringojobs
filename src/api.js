const API_TOKEN = import.meta.env.VITE_APIFY_TOKEN
const ACTOR_ID = import.meta.env.VITE_APIFY_ACTOR_ID

const CACHE_KEY = 'gringojobs_cache'
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000

const DEFAULT_LOCATIONS = [
  "Mexico", "Guatemala", "Belize", "Honduras", "El Salvador", "Nicaragua",
  "Costa Rica", "Panama", "Cuba", "Dominican Republic", "Haiti",
  "Argentina", "Bolivia", "Brazil", "Chile", "Colombia", "Ecuador",
  "Paraguay", "Peru", "Uruguay", "Venezuela"
]

const DEFAULT_TITLES = [
  "Lead Engineer",
  "Software Engineer",
  "Web Engineer",
  "Data Scientist",
  "Senior Product Engineer",
  "Backend Engineer",
  "Frontend Engineer",
  "Full Stack Engineer",
  "DevOps Engineer",
  "QA Engineer",
  "Engineering Manager",
  "Tech Lead",
  "Solutions Architect",
  "Data Engineer",
  "Machine Learning Engineer",
  "Product Designer",
  "UI/UX Designer",
  "Technical Writer",
  "Scrum Master",
  "Product Manager",
]

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

export async function fetchJobsFromApify({ titleSearch, locationSearch, workArrangement, limit = 100, forceRefresh } = {}) {
  if (!forceRefresh) {
    const cached = getCachedJobs()
    if (cached) return cached
  }

  const body = {
    limit: Math.min(limit, 5000),
    timeRange: '24h',
    includeAi: true,
    includeLinkedIn: true,
    descriptionType: 'text',
    removeAgency: false,
    "remote only (legacy)": true,
    aiEmploymentTypeFilter: ['FULL_TIME'],
  }

  body.titleSearch = titleSearch ? [titleSearch] : DEFAULT_TITLES
  body.locationSearch = locationSearch ? [locationSearch] : DEFAULT_LOCATIONS
  if (workArrangement) body.aiWorkArrangementFilter = [workArrangement]

  const isDev = import.meta.env.DEV
  const apiUrl = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${API_TOKEN}`
  const url = isDev
    ? `/apify/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${API_TOKEN}`
    : `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`

  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `API error (${res.status})`)
  }

  const data = await res.json()
  const jobs = Array.isArray(data) ? data : data.data || []

  setCachedJobs(jobs)
  return jobs
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
    experienceLevel: job.ai_experience_level || '',
    description: (job.description_text || '').slice(0, 500),
    datePosted: job.date_posted || new Date().toISOString(),
    countries: job.countries_derived || [],
    cities: job.cities_derived || [],
    regions: job.regions_derived || [],
    remote: job.remote_derived || wt.toLowerCase().includes('remote'),
  }
}

function fmtSalary(v, c) {
  if (v >= 1000) return `${c} ${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`
  return `${c} ${v}`
}
