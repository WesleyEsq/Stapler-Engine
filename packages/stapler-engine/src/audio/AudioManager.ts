import type { UserSettings } from '../types/contracts';

export interface AudioTrackManifestEntry {
  opus: string;
  mp3: string;
  kind: 'bgm' | 'sfx' | 'voice';
}

export interface QueuedSfxRequest {
  soundId: string;
  queuedAtMs: number;
  priority: number;
}

/**
 * Pure concurrency & bounded-queue scheduler for SFX playback.
 * Enforces `maxConcurrentSfx`, drops stale queued sounds older than `staleAfterMs`,
 * and optionally steals the oldest active voice for high-priority SFX.
 */
export class SfxConcurrencyLimiter {
  readonly maxConcurrent: number;
  readonly maxQueueSize: number;
  readonly staleAfterMs: number;

  private readonly active: Array<{ instanceId: number; soundId: string; startedAtMs: number; priority: number }> = [];
  private readonly queue: QueuedSfxRequest[] = [];
  private nextInstanceId = 1;

  constructor(options: { maxConcurrent?: number; maxQueueSize?: number; staleAfterMs?: number } = {}) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? 8);
    this.maxQueueSize = Math.max(0, options.maxQueueSize ?? 6);
    this.staleAfterMs = Math.max(1, options.staleAfterMs ?? 150);
  }

  getActiveCount(): number {
    return this.active.length;
  }

  getQueuedCount(): number {
    return this.queue.length;
  }

  requestPlay(
    soundId: string,
    nowMs: number,
    priority = 0,
  ): { status: 'play'; instanceId: number; stolenInstanceId?: number } | { status: 'queued' } | { status: 'dropped' } {
    if (this.active.length < this.maxConcurrent) {
      const instanceId = this.nextInstanceId++;
      this.active.push({ instanceId, soundId, startedAtMs: nowMs, priority });
      return { status: 'play', instanceId };
    }

    // High-priority SFX can steal the oldest lower-or-equal priority active slot
    if (priority > 0) {
      const victimIdx = this.active.findIndex((a) => a.priority <= priority);
      if (victimIdx !== -1) {
        const victim = this.active.splice(victimIdx, 1)[0]!;
        const instanceId = this.nextInstanceId++;
        this.active.push({ instanceId, soundId, startedAtMs: nowMs, priority });
        return { status: 'play', instanceId, stolenInstanceId: victim.instanceId };
      }
    }

    // Otherwise place into bounded short queue
    if (this.maxQueueSize > 0) {
      if (this.queue.length >= this.maxQueueSize) {
        this.queue.shift();
      }
      this.queue.push({ soundId, queuedAtMs: nowMs, priority });
      return { status: 'queued' };
    }

    return { status: 'dropped' };
  }

  /** Marks an active SFX instance finished and dequeues the freshest non-stale queued item if any. */
  release(
    instanceId: number,
    nowMs: number,
  ): { soundId: string; instanceId: number } | null {
    const idx = this.active.findIndex((a) => a.instanceId === instanceId);
    if (idx !== -1) {
      this.active.splice(idx, 1);
    }

    while (this.queue.length > 0 && this.active.length < this.maxConcurrent) {
      const next = this.queue.shift()!;
      if (nowMs - next.queuedAtMs > this.staleAfterMs) {
        continue; // Drop stale queued SFX
      }
      const nextId = this.nextInstanceId++;
      this.active.push({
        instanceId: nextId,
        soundId: next.soundId,
        startedAtMs: nowMs,
        priority: next.priority,
      });
      return { soundId: next.soundId, instanceId: nextId };
    }

    return null;
  }

  clear(): void {
    this.active.length = 0;
    this.queue.length = 0;
  }
}

/**
 * Web Audio API player with dedicated BGM, SFX (concurrency-limited), and Voice
 * gain buses, `.opus` / `.mp3` format probing, and browser autoplay unlock.
 */
export class AudioManager {
  private readonly tracks: Record<string, AudioTrackManifestEntry>;
  private readonly limiter: SfxConcurrencyLimiter;
  private readonly preferredFormat: 'opus' | 'mp3';

  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private voiceGain: GainNode | null = null;

  private readonly decodedBuffers = new Map<string, AudioBuffer>();
  private readonly activeSfxNodes = new Map<number, AudioBufferSourceNode>();
  private activeBgmId: string | null = null;
  private activeBgmSource: AudioBufferSourceNode | null = null;
  private queuedBgmId: string | null = null;
  private activeVoiceSource: AudioBufferSourceNode | null = null;

  private bgmVolume = 0.7;
  private sfxVolume = 0.85;
  private voiceVolume = 0.9;
  private bgmMuted = false;
  private sfxMuted = false;
  private voiceMuted = false;
  private unlocked = false;

  constructor(options: {
    tracks?: Record<string, AudioTrackManifestEntry>;
    maxConcurrentSfx?: number;
  } = {}) {
    this.tracks = options.tracks ? { ...options.tracks } : {};
    this.limiter = new SfxConcurrencyLimiter({ maxConcurrent: options.maxConcurrentSfx ?? 8 });
    this.preferredFormat = detectPreferredAudioFormat();

    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this.unlockHandler, { once: true });
      window.addEventListener('keydown', this.unlockHandler, { once: true });
    }
  }

  getPreferredFormat(): 'opus' | 'mp3' {
    return this.preferredFormat;
  }

  private readonly unlockHandler = (): void => {
    void this.unlock();
  };

  async unlock(): Promise<void> {
    this.ensureGraph();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        return;
      }
    }
    this.unlocked = true;
    if (this.queuedBgmId) {
      const id = this.queuedBgmId;
      this.queuedBgmId = null;
      await this.playBgm(id);
    }
  }

  applySettings(settings: Pick<UserSettings, 'bgmVolume' | 'sfxVolume' | 'voiceVolume' | 'bgmMuted' | 'sfxMuted' | 'voiceMuted'>): void {
    this.bgmVolume = clamp01(settings.bgmVolume);
    this.sfxVolume = clamp01(settings.sfxVolume);
    this.voiceVolume = clamp01(settings.voiceVolume);
    this.bgmMuted = settings.bgmMuted;
    this.sfxMuted = settings.sfxMuted;
    this.voiceMuted = settings.voiceMuted;
    this.syncGains();
  }

  async playBgm(trackId: string, fadeSec = 0.45): Promise<void> {
    if (!this.tracks[trackId]) return;
    if (this.activeBgmId === trackId && this.activeBgmSource) return;

    this.ensureGraph();
    if (!this.ctx || !this.bgmGain) return;
    if (!this.unlocked && this.ctx.state === 'suspended') {
      this.queuedBgmId = trackId;
      return;
    }

    const buffer = await this.loadBuffer(trackId);
    if (!buffer || !this.ctx || !this.bgmGain) return;

    this.stopBgm();

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const trackGain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    trackGain.gain.setValueAtTime(0.001, now);
    trackGain.gain.linearRampToValueAtTime(1.0, now + Math.max(0.02, fadeSec));

    source.connect(trackGain);
    trackGain.connect(this.bgmGain);
    source.start();

    this.activeBgmId = trackId;
    this.activeBgmSource = source;
  }

  stopBgm(): void {
    if (this.activeBgmSource) {
      try {
        this.activeBgmSource.stop();
        this.activeBgmSource.disconnect();
      } catch {
        // Ignore already-stopped source
      }
      this.activeBgmSource = null;
    }
    this.activeBgmId = null;
  }

  async playSfx(soundId: string, priority = 0): Promise<void> {
    if (!this.tracks[soundId]) return;
    this.ensureGraph();
    if (!this.ctx || !this.sfxGain) return;
    if (this.ctx.state === 'suspended') return;

    const nowMs = performance.now();
    const decision = this.limiter.requestPlay(soundId, nowMs, priority);
    if (decision.status !== 'play') return;

    if (decision.stolenInstanceId !== undefined) {
      this.stopSfxInstance(decision.stolenInstanceId);
    }

    await this.startSfxInstance(soundId, decision.instanceId);
  }

  async playVoice(voiceId: string): Promise<void> {
    if (!this.tracks[voiceId]) return;
    this.ensureGraph();
    if (!this.ctx || !this.voiceGain || this.ctx.state === 'suspended') return;

    this.stopVoice();
    const buffer = await this.loadBuffer(voiceId);
    if (!buffer || !this.ctx || !this.voiceGain) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.voiceGain);
    source.onended = () => {
      if (this.activeVoiceSource === source) {
        this.activeVoiceSource = null;
      }
    };
    source.start();
    this.activeVoiceSource = source;
  }

  stopVoice(): void {
    if (this.activeVoiceSource) {
      try {
        this.activeVoiceSource.stop();
        this.activeVoiceSource.disconnect();
      } catch {
        // Ignore already-stopped source
      }
      this.activeVoiceSource = null;
    }
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this.unlockHandler);
      window.removeEventListener('keydown', this.unlockHandler);
    }
    this.stopBgm();
    this.stopVoice();
    for (const id of Array.from(this.activeSfxNodes.keys())) {
      this.stopSfxInstance(id);
    }
    this.limiter.clear();
    this.decodedBuffers.clear();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }

  private async startSfxInstance(soundId: string, instanceId: number): Promise<void> {
    const buffer = await this.loadBuffer(soundId);
    if (!buffer || !this.ctx || !this.sfxGain) {
      this.limiter.release(instanceId, performance.now());
      return;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.sfxGain);
    this.activeSfxNodes.set(instanceId, source);

    source.onended = () => {
      this.activeSfxNodes.delete(instanceId);
      const next = this.limiter.release(instanceId, performance.now());
      if (next) {
        void this.startSfxInstance(next.soundId, next.instanceId);
      }
    };
    source.start();
  }

  private stopSfxInstance(instanceId: number): void {
    const node = this.activeSfxNodes.get(instanceId);
    if (!node) return;
    this.activeSfxNodes.delete(instanceId);
    node.onended = null;
    try {
      node.stop();
      node.disconnect();
    } catch {
      // Ignore already-stopped node
    }
  }

  private async loadBuffer(trackId: string): Promise<AudioBuffer | null> {
    const cached = this.decodedBuffers.get(trackId);
    if (cached) return cached;
    if (!this.ctx) return null;

    const entry = this.tracks[trackId];
    if (!entry) return null;

    const primaryUrl = this.preferredFormat === 'opus' ? entry.opus : entry.mp3;
    const fallbackUrl = this.preferredFormat === 'opus' ? entry.mp3 : entry.opus;

    for (const url of [primaryUrl, fallbackUrl]) {
      if (!url) continue;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const arrayBuf = await res.arrayBuffer();
        const decoded = await this.ctx.decodeAudioData(arrayBuf);
        this.decodedBuffers.set(trackId, decoded);
        return decoded;
      } catch {
        // Try fallback format
      }
    }
    return null;
  }

  private ensureGraph(): void {
    if (this.ctx) return;
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.bgmGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.voiceGain = this.ctx.createGain();

    this.bgmGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);
    this.voiceGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
    this.syncGains();
  }

  private syncGains(): void {
    if (this.bgmGain) this.bgmGain.gain.value = this.bgmMuted ? 0 : this.bgmVolume;
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxMuted ? 0 : this.sfxVolume;
    if (this.voiceGain) this.voiceGain.gain.value = this.voiceMuted ? 0 : this.voiceVolume;
  }
}

function detectPreferredAudioFormat(): 'opus' | 'mp3' {
  if (typeof document === 'undefined') return 'opus';
  const probe = document.createElement('audio');
  if (
    probe.canPlayType('audio/ogg; codecs="opus"') !== '' ||
    probe.canPlayType('audio/webm; codecs="opus"') !== ''
  ) {
    return 'opus';
  }
  return 'mp3';
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
