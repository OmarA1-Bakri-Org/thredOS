export class SequentialScheduler {
  readonly maxConcurrency = 1 as const
  private tail: Promise<unknown> = Promise.resolve()
  private readonly jobs = new Map<string, Promise<unknown>>()

  enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.jobs.get(key) as Promise<T> | undefined
    if (existing) return existing
    const job = this.tail.then(work, work)
    this.jobs.set(key, job)
    this.tail = job.catch(() => undefined)
    void job.finally(() => this.jobs.delete(key)).catch(() => undefined)
    return job
  }

  get<T>(key: string): Promise<T> | null {
    return (this.jobs.get(key) as Promise<T> | undefined) ?? null
  }
}
