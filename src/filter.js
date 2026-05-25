import { franc } from 'franc-min'

const BLOCKED_LANGS = new Set(['spa', 'por'])

export function isLocalJob(job) {
  const text = [job.title, job.description_text].filter(Boolean).join(' ')
  if (text.length < 20) return false
  const lang = franc(text)
  return BLOCKED_LANGS.has(lang)
}

export function filterLocalJobs(jobs) {
  return jobs.filter(job => !isLocalJob(job))
}
