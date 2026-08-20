const expectedPlatform = process.argv[2]

if (!expectedPlatform) {
  console.error('[require-platform] Missing expected process.platform argument')
  process.exit(2)
}

if (process.platform !== expectedPlatform) {
  console.error(
    `[require-platform] This build must run on ${expectedPlatform}, but the current platform is ${process.platform}.\n` +
      'Taac contains native modules; use the matching CI workflow or a machine running the target OS.'
  )
  process.exit(1)
}

console.log(`[require-platform] Target platform confirmed: ${process.platform}/${process.arch}`)
