import { BlockDef } from './types';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  public muted = false;
  public volume = 0.5;

  private ensureCtx(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.noiseBuffer) {
      const sr = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, sr, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < sr; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    }
    return this.ctx;
  }

  private playFilteredNoise(freq: number, q: number, duration: number, gainAmt: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ensureCtx();
    if (!ctx || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, now);
    filter.Q.setValueAtTime(q, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainAmt * this.volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now, Math.random() * 0.5, duration);
    src.stop(now + duration + 0.02);
  }

  private playTone(freqStart: number, freqEnd: number, duration: number, gainAmt: number, wave: OscillatorType = 'triangle') {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainAmt * this.volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public playStep(soundGroup: BlockDef['soundGroup']) {
    const jitter = 0.9 + Math.random() * 0.2;
    switch (soundGroup) {
      case 'stone':
        this.playFilteredNoise(850 * jitter, 2.2, 0.07, 0.14);
        break;
      case 'wood':
        this.playTone(170 * jitter, 90, 0.06, 0.12, 'triangle');
        break;
      case 'sand':
      case 'snow':
        this.playFilteredNoise(1400 * jitter, 1.0, 0.09, 0.12);
        break;
      case 'water':
        this.playFilteredNoise(550 * jitter, 1.5, 0.14, 0.15, 'lowpass');
        break;
      default:
        this.playFilteredNoise(520 * jitter, 1.6, 0.07, 0.13);
        break;
    }
  }

  public playHit(soundGroup: BlockDef['soundGroup']) {
    const j = 0.88 + Math.random() * 0.24;
    if (soundGroup === 'stone') this.playTone(220 * j, 130, 0.05, 0.15, 'square');
    else if (soundGroup === 'wood') this.playTone(190 * j, 110, 0.055, 0.18, 'triangle');
    else this.playFilteredNoise(600 * j, 1.4, 0.05, 0.14);
  }

  public playBreak(soundGroup: BlockDef['soundGroup']) {
    const j = 0.85 + Math.random() * 0.3;
    if (soundGroup === 'glass') {
      this.playTone(1650 * j, 620, 0.12, 0.22, 'sawtooth');
      this.playFilteredNoise(3200, 1.5, 0.14, 0.25, 'highpass');
    } else if (soundGroup === 'stone') {
      this.playTone(150 * j, 65, 0.1, 0.26, 'square');
      this.playFilteredNoise(900 * j, 1.6, 0.12, 0.24);
    } else if (soundGroup === 'wood') {
      this.playTone(210 * j, 80, 0.1, 0.24, 'triangle');
      this.playFilteredNoise(700 * j, 1.8, 0.1, 0.18);
    } else {
      this.playFilteredNoise(460 * j, 1.2, 0.11, 0.24);
    }
  }

  public playPlace(soundGroup: BlockDef['soundGroup']) {
    const j = 0.92 + Math.random() * 0.16;
    if (soundGroup === 'stone') this.playTone(240 * j, 140, 0.07, 0.2, 'triangle');
    else if (soundGroup === 'wood') this.playTone(260 * j, 150, 0.07, 0.22, 'triangle');
    else this.playFilteredNoise(740 * j, 1.8, 0.075, 0.18);
  }

  public playSplash() {
    this.playFilteredNoise(420, 0.9, 0.28, 0.26, 'lowpass');
    this.playTone(240, 110, 0.15, 0.12, 'sine');
  }

  public playPickup() {
    this.playTone(580, 980, 0.08, 0.15, 'sine');
  }

  public playHurt() {
    this.playTone(175, 65, 0.16, 0.28, 'sawtooth');
  }

  public playEat() {
    this.playFilteredNoise(1100, 2.0, 0.08, 0.16);
  }
}

export const soundEngine = new SoundEngine();
