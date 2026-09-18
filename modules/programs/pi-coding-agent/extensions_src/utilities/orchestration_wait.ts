import type { WakeOrigin } from "./orchestration_execution.ts";

export type MeshWaitState = "disarmed" | "armed-running" | "armed-waiting";
export type MeshWaitInspection = "queued" | "pending" | "drained" | "invalid";
export type MeshWaitOutcome = "resumed" | "drained" | "aborted" | "invalid";

/** Process-local, single-session latch used by the orchestration auto-join agent_end hook. */
export class MeshArmedWait {
    private state: MeshWaitState = "disarmed";
    private bindingKey: string | undefined;
    private generation = 0;
    private wake: (() => void) | undefined;
    private queuedOrigin: WakeOrigin | undefined;

    get currentState(): MeshWaitState { return this.state; }

    arm(bindingKey: string): void {
        if (this.bindingKey !== bindingKey) this.disarm();
        this.bindingKey = bindingKey;
        if (this.state === "disarmed") this.state = "armed-running";
    }

    isArmed(bindingKey?: string): boolean {
        return this.state !== "disarmed" && (bindingKey === undefined || bindingKey === this.bindingKey);
    }

    recordWakeOrigin(origin: WakeOrigin): void {
        this.queuedOrigin ??= origin;
    }

    notifyQueued(origin: WakeOrigin = "mesh-event"): void {
        this.generation += 1;
        this.recordWakeOrigin(origin);
        this.wake?.();
    }

    takeWakeOrigin(): WakeOrigin | undefined {
        const origin = this.queuedOrigin;
        this.queuedOrigin = undefined;
        return origin;
    }

    peekWakeOrigin(): WakeOrigin | undefined {
        return this.queuedOrigin;
    }

    resume(): void {
        if (this.state !== "disarmed") this.state = "armed-running";
        this.queuedOrigin = undefined;
        this.wake = undefined;
    }

    disarm(): void {
        this.state = "disarmed";
        this.bindingKey = undefined;
        this.generation += 1;
        this.queuedOrigin = undefined;
        this.wake?.();
        this.wake = undefined;
    }

    async wait(bindingKey: string, signal: AbortSignal | undefined, inspect: () => Promise<MeshWaitInspection>): Promise<MeshWaitOutcome> {
        if (!this.isArmed(bindingKey)) return "invalid";
        if (signal?.aborted) { this.disarm(); return "aborted"; }
        this.state = "armed-waiting";
        const observedGeneration = this.generation;
        let resolveWake!: () => void;
        const awakened = new Promise<void>(resolve => { resolveWake = resolve; });
        this.wake = resolveWake;
        const abort = () => resolveWake();
        signal?.addEventListener("abort", abort, { once: true });
        try {
            let inspected = await inspect();
            if (signal?.aborted) { this.disarm(); return "aborted"; }
            if (this.generation !== observedGeneration) {
                inspected = await inspect();
                if (signal?.aborted) { this.disarm(); return "aborted"; }
            }
            if (!this.isArmed(bindingKey) || inspected === "invalid") { this.disarm(); return "invalid"; }
            if (inspected === "drained") { this.disarm(); return "drained"; }
            if (inspected === "queued") { this.resume(); return "resumed"; }
            await awakened;
            if (signal?.aborted) { this.disarm(); return "aborted"; }
            if (!this.isArmed(bindingKey)) return "invalid";
            this.resume();
            return "resumed";
        } finally {
            signal?.removeEventListener("abort", abort);
            if (this.wake === resolveWake) this.wake = undefined;
        }
    }
}
