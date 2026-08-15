export interface DeadlineSchedulerDependencies {
    now?: () => number;
    setTimeout?: (callback: () => void | Promise<void>, delayMs: number) => unknown;
    clearTimeout?: (timer: unknown) => void;
}

interface DeadlineJob {
    intervalMs: number;
    deadline: number;
    enabled: boolean;
    running?: Promise<void>;
    run: () => void | Promise<void>;
}

/** Private monotonic scheduler for independent orchestration maintenance deadlines. */
export class OrchestrationDeadlineScheduler {
    private readonly now: () => number;
    private readonly scheduleTimeout: (callback: () => void | Promise<void>, delayMs: number) => unknown;
    private readonly cancelTimeout: (timer: unknown) => void;
    private readonly jobs = new Map<string, DeadlineJob>();
    private timer: unknown;
    private stopped = false;

    constructor(dependencies: DeadlineSchedulerDependencies = {}) {
        this.now = dependencies.now ?? (() => performance.now());
        this.scheduleTimeout = dependencies.setTimeout ?? ((callback, delayMs) => globalThis.setTimeout(() => { void callback(); }, delayMs));
        this.cancelTimeout = dependencies.clearTimeout ?? (timer => globalThis.clearTimeout(timer as NodeJS.Timeout));
    }

    add(name: string, intervalMs: number, run: () => void | Promise<void>, options: { immediate?: boolean; enabled?: boolean } = {}): void {
        if (this.jobs.has(name)) throw new Error(`Duplicate orchestration deadline ${name}`);
        const now = this.now();
        this.jobs.set(name, { intervalMs, deadline: options.immediate ? now : now + intervalMs, enabled: options.enabled ?? true, run });
    }

    start(): void { this.reschedule(); }

    setEnabled(name: string, enabled: boolean, immediate = false): void {
        const job = this.jobs.get(name); if (!job) throw new Error(`Unknown orchestration deadline ${name}`);
        if (job.enabled === enabled && !immediate) return;
        job.enabled = enabled;
        if (enabled) job.deadline = immediate ? this.now() : this.now() + job.intervalMs;
        this.reschedule();
    }

    private advance(job: DeadlineJob, observedAt: number): void {
        do job.deadline += job.intervalMs; while (job.deadline <= observedAt);
    }

    private reschedule(): void {
        if (this.stopped) return;
        if (this.timer !== undefined) { this.cancelTimeout(this.timer); this.timer = undefined; }
        const deadlines = [...this.jobs.values()].filter(job => job.enabled && !job.running).map(job => job.deadline);
        if (!deadlines.length) return;
        const delay = Math.max(0, Math.min(...deadlines) - this.now());
        this.timer = this.scheduleTimeout(async () => { this.timer = undefined; await this.wake(); }, delay);
    }

    private async wake(): Promise<void> {
        if (this.stopped) return;
        const observedAt = this.now();
        const started: Promise<void>[] = [];
        for (const job of this.jobs.values()) {
            if (!job.enabled || job.running || job.deadline > observedAt) continue;
            this.advance(job, observedAt);
            const running = Promise.resolve().then(job.run);
            job.running = running;
            const finish = () => { if (job.running === running) job.running = undefined; this.reschedule(); };
            void running.then(finish, finish);
            started.push(running);
        }
        this.reschedule();
        await Promise.all(started.map(pass => pass.catch(() => {})));
    }

    async stop(): Promise<void> {
        this.stopped = true;
        if (this.timer !== undefined) { this.cancelTimeout(this.timer); this.timer = undefined; }
        const running = [...this.jobs.values()].flatMap(job => job.running ? [job.running.catch(() => {})] : []);
        await Promise.all(running);
    }
}
