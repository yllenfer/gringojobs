import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const TOKEN = process.env.APIFY_TOKEN
const ACTOR_ID = process.env.APIFY_ACTOR_ID || 'fantastic-jobs~career-site-job-listing-api'

if (!TOKEN) {
  console.error('APIFY_TOKEN env var is required')
  process.exit(1)
}

console.log('Fetching jobs from Apify...')

const res = await fetch(
  `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${TOKEN}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeRange: '7d',
      limit: 1000,
      includeAi: true,
      descriptionType: 'text',
      populateAiRemoteLocation: false,
      populateAiRemoteLocationDerived: false,
    }),
  }
)

if (!res.ok) {
  const err = await res.json().catch(() => ({}))
  console.error('Apify error:', err.error?.message || res.status)
  process.exit(1)
}

const data = await res.json()
const jobs = Array.isArray(data) ? data : data.data || []

writeFileSync(join(__dirname, '../public/jobs.json'), JSON.stringify(jobs))
console.log(`Wrote ${jobs.length} jobs to public/jobs.json`)
