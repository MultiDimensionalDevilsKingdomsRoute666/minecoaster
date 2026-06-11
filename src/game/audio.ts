/**
 * All game audio is synthesized with WebAudio — no audio files.
 * The AudioContext is created lazily on the first user gesture (browser
 * autoplay policy) and every effect degrades to a no-op until then.
 */

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private muted = false;
  private clankTimer = 0;

  /** Create the context (must be called from a user gesture). */
  resume(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.startWind();
    this.startAmbientPad();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  private noiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private startWind(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(2);
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master!);
    src.start();
  }

  private startAmbientPad(): void {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0.025;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    for (const [freq, detune] of [
      [110, -6],
      [110, 6],
      [165, 0],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start();
    }
    filter.connect(gain).connect(this.master!);
  }

  /** Per-frame update: wind howl scales with speed, chain clanks in lift zones. */
  update(dt: number, speed: number, inLift: boolean): void {
    if (!this.ctx || !this.windGain || !this.windFilter) return;
    const t = this.ctx.currentTime;
    const windAmount = Math.min(1, speed / 28);
    this.windGain.gain.setTargetAtTime(windAmount * 0.35, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(300 + windAmount * 900, t, 0.1);

    if (inLift && speed > 0.1) {
      this.clankTimer -= dt;
      if (this.clankTimer <= 0) {
        this.clankTimer = 0.9 / Math.max(1, speed);
        this.clank();
      }
    }
  }

  private clank(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(2200 + Math.random() * 400, t);
    osc.frequency.exponentialRampToValueAtTime(700, t + 0.04);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  /** Rushing-air sweep for the big drop. */
  whoosh(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(1.2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(250, t);
    filter.frequency.exponentialRampToValueAtTime(1800, t + 0.9);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t);
    src.stop(t + 1.3);
  }

  splash(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.8);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(300, t + 0.6);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t);
    src.stop(t + 0.8);
  }

  /** Brake-run screech. */
  screech(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1900, t);
    osc.frequency.exponentialRampToValueAtTime(600, t + 0.8);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.07, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.9);
  }

  fireworkPop(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + Math.random() * 0.15;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.4);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(5000, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + 0.35);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t);
    src.stop(t + 0.45);
  }

  /** Cheerful little arpeggio when a lap completes. */
  lapChime(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.09;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  }
}
