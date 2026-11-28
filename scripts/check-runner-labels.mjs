#!/usr/bin/env node
// Every job runs on a GitHub-hosted runner. A self-hosted label fails, and so
// does any label outside the allowlist below (an invented name such as
// foo-latest included). This check does not look at fork or repository
// guards; those belong to another change.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? '.github/workflows'
// GitHub-hosted images this repository may name. Anything else fails.
const HOSTED = new Set([
  'ubuntu-latest',
  'ubuntu-24.04',
  'ubuntu-22.04',
  'ubuntu-24.04-arm',
  'ubuntu-22.04-arm',
  'windows-latest',
  'windows-11-arm',
  'windows-2025',
  'windows-2022',
  'macos-latest',
  'macos-15',
  'macos-14',
])
const isHosted = (label) => HOSTED.has(label)
const problems = []

const stripQuote = (s) => s.trim().replace(/^['"]|['"]$/g, '')
const isDynamicExpr = (s) => /\$\{\{|fromJSON/i.test(s)

/** Job id lines sit at indent 2 under `jobs:`. */
const isJobKey = (line) => /^  [A-Za-z0-9_-]+:\s*$/.test(line) || /^  [A-Za-z0-9_-]+:\s+\S/.test(line)

/**
 * Resolve matrix.<key> from the same job's matrix block (direct list or
 * include: entries). Dynamic expressions and a missing key are not resolved.
 * @returns {{ status: 'static', values: string[] } | { status: 'dynamic' } | { status: 'missing' }}
 */
function resolveMatrixValues(lines, runsOnIndex, key) {
  let jobStart = 0
  for (let j = runsOnIndex; j >= 0; j--) {
    if (isJobKey(lines[j])) {
      jobStart = j
      break
    }
  }
  let jobEnd = lines.length
  for (let j = runsOnIndex + 1; j < lines.length; j++) {
    if (isJobKey(lines[j])) {
      jobEnd = j
      break
    }
    if (/^[A-Za-z0-9_-]+:/.test(lines[j])) {
      jobEnd = j
      break
    }
  }

  let matrixStart = -1
  let matrixIndent = -1
  for (let j = jobStart; j < jobEnd; j++) {
    const mm = lines[j].match(/^(\s*)matrix\s*:\s*(.*)$/)
    if (!mm) continue
    matrixStart = j
    matrixIndent = mm[1].length
    break
  }
  if (matrixStart < 0) return { status: 'missing' }

  let bodyEnd = jobEnd
  for (let j = matrixStart + 1; j < jobEnd; j++) {
    if (lines[j].trim() === '' || lines[j].trim().startsWith('#')) continue
    const indent = lines[j].match(/^(\s*)/)[1].length
    if (indent <= matrixIndent) {
      bodyEnd = j
      break
    }
  }
  const bodyStart = matrixStart + 1
  const values = []
  let sawKey = false
  let sawDynamic = false

  const takeValue = (raw) => {
    const v = raw.replace(/\s+#.*$/, '').trim()
    if (!v) return
    sawKey = true
    if (isDynamicExpr(v)) {
      sawDynamic = true
      return
    }
    values.push(stripQuote(v))
  }

  for (let j = bodyStart; j < bodyEnd; j++) {
    const list = lines[j].match(new RegExp(`^\\s*${key}\\s*:\\s*\\[(.*)\\]\\s*$`))
    if (list) {
      sawKey = true
      if (isDynamicExpr(list[1])) {
        sawDynamic = true
        continue
      }
      for (const part of list[1].split(',')) {
        const v = stripQuote(part)
        if (v) values.push(v)
      }
      continue
    }
    const bare = lines[j].match(new RegExp(`^\\s*${key}\\s*:\\s*(.*)$`))
    if (!bare) continue
    const raw = bare[1].replace(/\s+#.*$/, '').trim()
    if (raw === '' || raw === '|' || raw === '>') {
      sawKey = true
      for (let k = j + 1; k < bodyEnd; k++) {
        if (lines[k].trim() === '' || lines[k].trim().startsWith('#')) continue
        const item = lines[k].match(/^\s*-\s+(.+)$/)
        if (!item) break
        const v = item[1].replace(/\s+#.*$/, '').trim()
        // Scalar list item (`- ubuntu-latest`), not a mapping (`- runner: …`).
        if (v.includes(':')) break
        if (isDynamicExpr(v)) {
          sawDynamic = true
          continue
        }
        values.push(stripQuote(v))
      }
      continue
    }
    takeValue(raw)
  }

  // include: entries — `- runner: windows-2025` or a following `runner:` line.
  for (let j = bodyStart; j < bodyEnd; j++) {
    const inc = lines[j].match(/^(\s*)include\s*:\s*$/)
    if (!inc) continue
    const incIndent = inc[1].length
    for (let k = j + 1; k < bodyEnd; k++) {
      if (lines[k].trim() === '' || lines[k].trim().startsWith('#')) continue
      const indent = lines[k].match(/^(\s*)/)[1].length
      if (indent <= incIndent) break
      const withDash = lines[k].match(new RegExp(`^\\s*-\\s+${key}\\s*:\\s*(.+)$`))
      const nested = lines[k].match(new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`))
      const hit = withDash || nested
      if (hit) takeValue(hit[1])
    }
  }

  if (sawDynamic) return { status: 'dynamic' }
  if (!sawKey || values.length === 0) return { status: 'missing' }
  return { status: 'static', values }
}

for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
  const path = join(dir, file)
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    const m = line.match(/^(\s*)runs-on:\s*(.*)$/)
    if (!m || line.trim().startsWith('#')) return
    let value = m[2].replace(/\s+#.*$/, '').trim()
    // Block form: collect the following "- label" lines.
    if (value === '' || value === '|' || value === '>') {
      const items = []
      for (let j = i + 1; j < lines.length; j++) {
        const item = lines[j].match(/^\s*-\s*(.+)$/)
        if (!item) break
        items.push(item[1].trim())
      }
      value = `[${items.join(', ')}]`
    }
    const where = `${path}:${i + 1}`
    const labels = []
    if (value.includes('${{')) {
      for (const q of value.matchAll(/['"]([^'"]+)['"]/g)) labels.push(q[1])
    } else {
      labels.push(...value.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean))
    }
    const selfHosted = value.includes('self-hosted') || labels.includes('self-hosted')
    if (selfHosted)
      problems.push(`${where}: runs-on uses a self-hosted label: ${value}`)
    else {
      const matrixRef = value.match(/\$\{\{\s*matrix\.(\w+)\s*\}\}/)
      // Unquoted ${{ matrix.X }}: resolve X from this job's matrix block.
      if (labels.length === 0 && matrixRef) {
        const key = matrixRef[1]
        const resolved = resolveMatrixValues(lines, i, key)
        if (resolved.status === 'static') {
          const selfHostedValues = resolved.values.filter((l) => l.includes('self-hosted'))
          if (selfHostedValues.length)
            problems.push(`${where}: runs-on uses a self-hosted label: ${selfHostedValues.join(', ')}`)
          const bad = resolved.values.filter((l) => !isHosted(l) && !l.includes('self-hosted'))
          if (bad.length)
            problems.push(`${where}: runs-on is not a GitHub-hosted label: ${bad.join(', ')}`)
        } else if (key === 'os') {
          // Legacy: matrix.os may be fromJSON(...); literal os: [..] is checked below.
        } else {
          // Missing key or dynamic expression: cannot prove a hosted runner.
          problems.push(`${where}: runs-on is not a GitHub-hosted label: ${value}`)
        }
      } else {
        const bad = labels.filter((l) => !isHosted(l))
        if (bad.length || labels.length === 0)
          problems.push(`${where}: runs-on is not a GitHub-hosted label: ${value}`)
      }
    }
  })
  lines.forEach((line, i) => {
    const m = line.match(/^\s*os:\s*\[(.*)\]/)
    if (!m) return
    const routed = lines.some((l) => /runs-on:.*matrix\.os/.test(l))
    if (!routed) return
    const values = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    const selfHostedValues = values.filter((l) => l.includes('self-hosted'))
    if (selfHostedValues.length)
      problems.push(`${path}:${i + 1}: matrix os uses a self-hosted label: ${selfHostedValues.join(', ')}`)
    const bad = values.filter((l) => !isHosted(l) && !l.includes('self-hosted'))
    if (bad.length) problems.push(`${path}:${i + 1}: matrix os is not a GitHub-hosted label: ${bad.join(', ')}`)
  })
}

if (problems.length) {
  console.error(`runner guard failed (${problems.length}):`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log('runner guard: every job uses a GitHub-hosted runner')
