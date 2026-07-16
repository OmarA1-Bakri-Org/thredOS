const count = Number.parseInt(process.argv[2] ?? '20', 10)
const intervalMs = Number.parseInt(process.argv[3] ?? '5', 10)

let emitted = 0
const timer = setInterval(() => {
  emitted += 1
  process.stdout.write(`heartbeat:${emitted}\n`)
  if (emitted >= count) {
    clearInterval(timer)
  }
}, intervalMs)
