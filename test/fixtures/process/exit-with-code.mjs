const exitCode = Number.parseInt(process.argv[2] ?? '0', 10)
const outputBytes = Number.parseInt(process.argv[3] ?? '0', 10)

if (outputBytes > 0) {
  process.stdout.write('o'.repeat(outputBytes))
  process.stderr.write('e'.repeat(outputBytes))
}

process.exit(Number.isFinite(exitCode) ? exitCode : 1)
