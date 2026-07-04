/**
 * RealtimeTranscriptionService — live meeting transcription orchestrator
 *
 * One session per recording: a Silero VAD per track segments the incoming
 * PCM stream into utterances; each finalized utterance is transcribed by the
 * Qwen3-ASR MLX sidecar (per-utterance language auto-detection). Segments are
 * broadcast to the renderer as they complete and accumulated so the finished
 * session can hand AudioManager per-track TranscriptionResults — letting the
 * post-processing pipeline skip whisper entirely.
 *
 * Failure semantics: any sidecar failure marks the session dead, the partial
 * transcript is discarded, and finishSession() returns null — the caller then
 * falls back to the whisper post-processing path (the WAV always exists).
 * Recording itself is never blocked by this service.
 *
 * §3.4  abortSession()/abortAll() dispose the sidecar — never leaves orphans
 * §3.7  all log lines are prefixed with [RealtimeTranscription]
 */

import { BrowserWindow } from 'electron'
import { isCrossTalkDuplicate } from '../crossTalk'
import { getLanguageName, normalizeLanguageCode } from '../language'
import type { TranscriptionResult } from '../types'
import { AsrSidecarManager } from './AsrSidecarManager'
import { getAsrModelDir, getVadModelPath } from './availability'
import { majorityLanguage } from './languageVote'
import { resolveAsrBridgePath, resolveAsrPython } from './pythonRuntime'
import { VAD_SAMPLE_RATE, VadSegmenter } from './VadSegmenter'
import type { RealtimeSegment, RealtimeSessionResult, RealtimeStatus, RealtimeTrack } from './types'

interface RealtimeSession {
  noteId: string
  /** Full language name hint for the sidecar ('' → per-utterance auto-detect) */
  pinnedLanguageName: string
  vads: Map<RealtimeTrack, VadSegmenter>
  sidecar: AsrSidecarManager
  segments: Map<RealtimeTrack, RealtimeSegment[]>
  /** In-flight sidecar transcriptions, awaited before finishing the session */
  inFlight: Set<Promise<void>>
  /** Set on any sidecar failure — the session result is discarded */
  dead: boolean
}

export class RealtimeTranscriptionService {
  private static instance: RealtimeTranscriptionService | null = null
  private session: RealtimeSession | null = null

  static getInstance(): RealtimeTranscriptionService {
    if (!this.instance) {
      this.instance = new RealtimeTranscriptionService()
    }
    return this.instance
  }

  /**
   * Start a live transcription session. Caller must have verified
   * checkRealtimeAvailability() first. Throws on VAD/runtime setup failure —
   * the caller treats that as "realtime unavailable" and keeps recording.
   *
   * Resolves as soon as the session accepts PCM: the sidecar keeps loading the
   * model in the background so no speech from the start of the meeting is
   * lost — utterances detected meanwhile queue on the bridge's stdin and are
   * transcribed right after init. 'live'/'failed' arrive via status events.
   */
  async startSession(options: {
    noteId: string
    hasSystemTrack: boolean
    /** 'auto' or an ISO 639-1 code pinned by the user for this recording */
    language: string
  }): Promise<void> {
    if (this.session) {
      // A stale session means the previous recording did not stop cleanly
      console.warn('[RealtimeTranscription] Stale session found — aborting it first')
      await this.abortSession(this.session.noteId)
    }

    const { noteId } = options
    this.broadcastStatus(noteId, 'starting')

    const pinnedCode = normalizeLanguageCode(options.language)
    const session: RealtimeSession = {
      noteId,
      pinnedLanguageName: pinnedCode ? getLanguageName(pinnedCode) : '',
      vads: new Map(),
      sidecar: new AsrSidecarManager(),
      segments: new Map([['mic', []]]),
      inFlight: new Set(),
      dead: false
    }
    if (options.hasSystemTrack) {
      session.segments.set('system', [])
    }
    this.session = session

    try {
      const pythonPath = await resolveAsrPython()
      if (!pythonPath) {
        throw new Error('ASR Python runtime not found')
      }

      const tracks: RealtimeTrack[] = options.hasSystemTrack ? ['mic', 'system'] : ['mic']
      for (const track of tracks) {
        const vad = new VadSegmenter({
          vadModelPath: getVadModelPath(),
          onUtterance: (utterance) => this.handleUtterance(session, track, utterance)
        })
        await vad.initialize()
        session.vads.set(track, vad)
      }

      session.sidecar.onExit(() => this.failSession(session, 'Transcription engine stopped'))

      // Background init — spawn happens synchronously inside initialize(), so
      // transcribe() calls queue on the bridge's stdin from this point on.
      void session.sidecar
        .initialize({
          pythonPath,
          bridgePath: resolveAsrBridgePath(),
          modelPath: getAsrModelDir()
        })
        .then(() => {
          if (this.session === session && !session.dead) {
            this.broadcastStatus(noteId, 'live')
            console.log(`[RealtimeTranscription] Session live for note ${noteId}`)
          }
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          this.failSession(session, message)
        })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[RealtimeTranscription] Failed to start session: ${message}`)
      await this.cleanupSession(session)
      this.session = null
      this.broadcastStatus(noteId, 'failed', message)
      throw error
    }
  }

  /**
   * Feed a PCM chunk (s16le 16 kHz mono) for a track. Silently ignored when
   * no live session matches — the renderer may race a few chunks around
   * start/stop boundaries and that is fine.
   */
  pushPcm(noteId: string, track: RealtimeTrack, pcm: Int16Array): void {
    const session = this.session
    if (!session || session.noteId !== noteId || session.dead) return

    session.vads.get(track)?.accept(pcm)
  }

  /**
   * Finish the session: flush VADs, await in-flight transcriptions, then
   * synthesize per-track TranscriptionResults. Returns null when the session
   * failed (caller falls back to whisper). Disposes the sidecar immediately —
   * before the summary LLM loads — to keep peak memory sane on 16GB machines.
   */
  async finishSession(noteId: string): Promise<RealtimeSessionResult | null> {
    const session = this.session
    if (!session || session.noteId !== noteId) return null

    // Final utterances without closing silence are flushed out here
    for (const vad of session.vads.values()) {
      try {
        vad.flush()
      } catch (error) {
        console.warn(`[RealtimeTranscription] VAD flush failed: ${error}`)
      }
    }

    // Wait for every queued transcription (they resolve in submission order)
    await Promise.allSettled([...session.inFlight])

    const dead = session.dead
    await this.cleanupSession(session)
    this.session = null
    this.broadcastStatus(noteId, 'stopped')

    if (dead) {
      console.warn('[RealtimeTranscription] Session failed — discarding partial transcript')
      return null
    }

    const mic = this.buildTrackResult(session, 'mic')
    const system = session.segments.has('system')
      ? this.buildTrackResult(session, 'system')
      : undefined

    console.log(
      `[RealtimeTranscription] Session finished: mic ${mic.segments.length} segments` +
        (system ? `, system ${system.segments.length} segments` : '')
    )
    return { mic, system }
  }

  /**
   * Abort the session and discard everything (error paths, app quit).
   * Deliberately broadcasts NO status: aborts are initiated by the renderer,
   * which already owns its live-transcription state — a 'stopped' event here
   * would overwrite an 'unavailable' status the renderer just set.
   */
  async abortSession(noteId: string): Promise<void> {
    const session = this.session
    if (!session || session.noteId !== noteId) return

    // Mark dead FIRST so a late sidecar 'ready' during cleanup cannot
    // broadcast 'live' for a session that is being torn down.
    session.dead = true
    await this.cleanupSession(session)
    this.session = null
    console.log(`[RealtimeTranscription] Session aborted for note ${noteId}`)
  }

  /** Abort whatever session exists (before-quit hardening). */
  async abortAll(): Promise<void> {
    if (this.session) {
      await this.abortSession(this.session.noteId)
    }
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private handleUtterance(
    session: RealtimeSession,
    track: RealtimeTrack,
    utterance: { startSample: number; samples: Float32Array }
  ): void {
    if (session.dead) return

    const startTime = utterance.startSample / VAD_SAMPLE_RATE
    const endTime = startTime + utterance.samples.length / VAD_SAMPLE_RATE
    console.log(
      `[RealtimeTranscription] Utterance (${track}) ${startTime.toFixed(1)}s → ${endTime.toFixed(1)}s`
    )

    // The sidecar expects s16le PCM
    const pcm = new Int16Array(utterance.samples.length)
    for (let i = 0; i < utterance.samples.length; i++) {
      const clamped = Math.max(-1, Math.min(1, utterance.samples[i]))
      pcm[i] = Math.round(clamped * 32767)
    }

    const task = session.sidecar
      .transcribe(pcm, session.pinnedLanguageName || undefined)
      .then((result) => {
        const text = result.text.trim()
        if (!text) return

        const segment: RealtimeSegment = {
          noteId: session.noteId,
          track,
          startTime,
          endTime,
          text,
          language: normalizeLanguageCode(result.language)
        }
        // Always store — the authoritative cross-talk dedup happens in
        // AudioManager.buildRemoteTimeline with proper speaker attribution.
        session.segments.get(track)?.push(segment)

        // Live view: suppress acoustic-echo copies (no headphones → the mic
        // hears the speakers, so remote speech would show up twice).
        const otherTrack: RealtimeTrack = track === 'mic' ? 'system' : 'mic'
        const otherSegments = session.segments.get(otherTrack)
        if (otherSegments && isCrossTalkDuplicate(segment, otherSegments)) {
          console.log(
            `[RealtimeTranscription] Suppressed live echo (${track}) at ${startTime.toFixed(1)}s`
          )
          return
        }
        this.broadcastSegment(segment)
      })
      .catch((error) => {
        // Per-utterance errors are tolerated; systemic failures arrive via onExit
        console.warn(`[RealtimeTranscription] Utterance transcription failed: ${error.message}`)
      })
      .finally(() => {
        session.inFlight.delete(task)
      }) as Promise<void>

    session.inFlight.add(task)
  }

  private failSession(session: RealtimeSession, message: string): void {
    if (session.dead) return
    session.dead = true
    console.error(`[RealtimeTranscription] Session failed: ${message}`)
    // A session already replaced/aborted must not emit stale status events
    if (this.session === session) {
      this.broadcastStatus(session.noteId, 'failed', message)
    }
  }

  private buildTrackResult(session: RealtimeSession, track: RealtimeTrack): TranscriptionResult {
    const segments = [...(session.segments.get(track) ?? [])].sort(
      (a, b) => a.startTime - b.startTime
    )
    return {
      text: segments.map((s) => s.text).join(' '),
      segments: segments.map((s) => ({
        startTime: s.startTime,
        endTime: s.endTime,
        text: s.text
      })),
      detectedLanguage: majorityLanguage(segments)
    }
  }

  private async cleanupSession(session: RealtimeSession): Promise<void> {
    for (const vad of session.vads.values()) {
      try {
        vad.dispose()
      } catch {
        // Native teardown failures must not block session cleanup
      }
    }
    session.vads.clear()
    await session.sidecar.dispose()
  }

  private broadcastSegment(segment: RealtimeSegment): void {
    this.broadcast('audio:realtime-segment', segment)
  }

  private broadcastStatus(noteId: string, status: RealtimeStatus, message?: string): void {
    this.broadcast('audio:realtime-status', { noteId, status, message })
  }

  private broadcast(channel: string, payload: unknown): void {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.webContents.isDestroyed()) {
        win.webContents.send(channel, payload)
      }
    })
  }
}
