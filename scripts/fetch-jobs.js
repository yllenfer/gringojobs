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

const LOCATIONS = [
  // Central America
  'Mexico', 'Guatemala', 'Belize', 'Honduras', 'El Salvador', 'Nicaragua',
  'Costa Rica', 'Panama',
  // Caribbean
  'Cuba', 'Dominican Republic', 'Haiti', 'Jamaica', 'Trinidad and Tobago',
  'Puerto Rico', 'Barbados', 'Bahamas',
  // South America
  'Argentina', 'Bolivia', 'Brazil', 'Chile', 'Colombia', 'Ecuador',
  'Paraguay', 'Peru', 'Uruguay', 'Venezuela', 'Guyana', 'Suriname',
  // Common "Latin America" or "LATAM" search terms some postings use
  'Latin America', 'LATAM', 'South America',
]

const TITLES = [
  // Software Engineering
  'Software Engineer', 'Software Developer', 'Backend Engineer', 'Frontend Engineer',
  'Full Stack Engineer', 'Full Stack Developer', 'Web Engineer', 'Web Developer',
  'iOS Engineer', 'iOS Developer', 'Android Engineer', 'Android Developer',
  'Mobile Engineer', 'Mobile Developer', 'Embedded Systems Engineer',
  // Senior / Lead / Staff
  'Senior Software Engineer', 'Senior Engineer', 'Senior Developer',
  'Lead Engineer', 'Staff Engineer', 'Principal Engineer', 'Senior Product Engineer',
  // Specialized Engineering
  'Platform Engineer', 'Infrastructure Engineer', 'Cloud Engineer',
  'DevOps Engineer', 'Site Reliability Engineer', 'SRE', 'Systems Engineer',
  'Network Engineer', 'Security Engineer', 'Cybersecurity Engineer',
  'Game Developer', 'Blockchain Developer', 'Smart Contract Developer',
  // Data & AI / ML
  'Data Scientist', 'Data Engineer', 'Data Analyst', 'Analytics Engineer',
  'Machine Learning Engineer', 'ML Engineer', 'AI Engineer',
  'Business Intelligence Developer', 'BI Developer',
  // Architecture & Management
  'Solutions Architect', 'Cloud Architect', 'Enterprise Architect',
  'Tech Lead', 'Engineering Manager', 'Engineering Lead',
  // QA & Testing
  'QA Engineer', 'Quality Assurance Engineer', 'Test Automation Engineer',
  'SDET', 'QA Analyst',
  // Product & Design
  'Product Manager', 'Product Designer', 'UI/UX Designer', 'UX Designer',
  'UI Designer', 'Product Owner',
  // Other technical
  'Technical Writer', 'Developer Advocate', 'Developer Relations',
  'Scrum Master', 'Agile Coach', 'Database Administrator', 'DBA',
  'CTO', 'VP of Engineering',
]

console.log('Fetching jobs from Apify...')

const res = await fetch(
  `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${TOKEN}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      limit: 1000,
      maxChargedResults: 1000,
      timeRange: '7d',
      includeAi: true,
      includeLinkedIn: true,
      descriptionType: 'text',
      removeAgency: false,
      'remote only (legacy)': true,
      aiEmploymentTypeFilter: ['FULL_TIME'],
      titleSearch: TITLES,
      locationSearch: LOCATIONS,
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
