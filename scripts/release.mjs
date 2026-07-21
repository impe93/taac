// Cuts a release: bumps the version, tags it and pushes — the `v*` tag is what
// triggers .github/workflows/release.yml, which builds, signs, notarizes and
// publishes the macOS artifacts to a GitHub Release.
//
// Usage: node scripts/release.mjs <patch|minor|major> [--allow-branch <name>] [--dry-run]
//        (normally via `pnpm release:patch` / `release:minor` / `release:major`)

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const VALID_BUMPS = ['patch', 'minor', 'major']
/** Branch releases are cut from unless overridden with --allow-branch. */
const DEFAULT_BRANCH = 'main'

const args = process.argv.slice(2)
const bump = args[0]
const dryRun = args.includes('--dry-run')
const branchFlagIndex = args.indexOf('--allow-branch')
const expectedBranch = branchFlagIndex === -1 ? DEFAULT_BRANCH : args[branchFlagIndex + 1]

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

function run(command, commandArgs, { capture = false } = {}) {
  return execFileSync(command, commandArgs, {
    cwd: ROOT,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8'
  })
}

if (!VALID_BUMPS.includes(bump)) {
  fail(`Usage: node scripts/release.mjs <${VALID_BUMPS.join('|')}> [--allow-branch <name>]`)
}
if (branchFlagIndex !== -1 && !expectedBranch) {
  fail('--allow-branch requires a branch name')
}

// 1. The tree must be clean: `npm version` refuses to run otherwise, and a dirty
//    tree would silently ship uncommitted work.
const status = run('git', ['status', '--porcelain'], { capture: true }).trim()
if (status) {
  fail('Working tree is not clean. Commit or stash your changes first.')
}

const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true }).trim()
if (branch !== expectedBranch) {
  fail(
    `On branch "${branch}" but releases are cut from "${expectedBranch}". ` +
      `Pass --allow-branch ${branch} to override.`
  )
}

// 2. Never tag something that does not compile.
console.log('\n▸ Running typecheck…')
run('npm', ['run', 'typecheck'])

// Lint is advisory only: the repo carries pre-existing react-refresh errors in
// the generated Shadcn `ui/*` components, so a red lint must not block a release.
console.log('\n▸ Running lint (advisory)…')
try {
  run('npm', ['run', 'lint'])
} catch {
  console.warn('\n⚠ Lint reported problems — continuing (see output above).')
}

const currentVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version

if (dryRun) {
  console.log(`\n✓ Dry run OK — would bump ${currentVersion} (${bump}) and push the tag.\n`)
  process.exit(0)
}

// 3. `npm version` writes package.json, commits and creates the annotated tag.
console.log(`\n▸ Bumping version (${bump}) from ${currentVersion}…`)
run('npm', ['version', bump, '-m', 'chore(release): v%s'])

const newVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version

console.log(`\n▸ Pushing ${branch} and tag v${newVersion}…`)
run('git', ['push', '--follow-tags'])

console.log(
  `\n✓ Released v${newVersion}.\n` +
    '  The release workflow is now building, signing and notarizing on GitHub Actions:\n' +
    '  https://github.com/impe93/taac/actions/workflows/release.yml\n'
)
