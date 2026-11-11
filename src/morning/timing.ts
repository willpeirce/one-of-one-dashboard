export const MORNING_STAGES = ['auth','cache','controls','project','state','render'] as const;
export type MorningStage = typeof MORNING_STAGES[number];
export class MorningTiming {
  private readonly started = performance.now();
  private readonly durations = new Map<MorningStage,number>();
  async measure<T>(stage: MorningStage,work: () => Promise<T>): Promise<T> {
    const at = performance.now();
    try { return await work(); } finally { this.add(stage,performance.now() - at); }
  }
  sync<T>(stage: MorningStage,work: () => T): T {
    const at = performance.now();
    try { return work(); } finally { this.add(stage,performance.now() - at); }
  }
  log(totalMs?: number): void {
    try {
      console.info(`Morning request timings: ${MORNING_STAGES.map(stage => `${stage}=${(this.durations.get(stage) ?? 0).toFixed(1)}ms`).join(' ')} total=${(totalMs ?? performance.now() - this.started).toFixed(1)}ms`);
    } catch { /* Timing diagnostics cannot change a response. */ }
  }
  private add(stage: MorningStage,duration: number): void { this.durations.set(stage,(this.durations.get(stage) ?? 0) + duration); }
}
export const timed = <T>(timing: MorningTiming | undefined,stage: MorningStage,work: () => Promise<T>): Promise<T> => timing ? timing.measure(stage,work) : work();
