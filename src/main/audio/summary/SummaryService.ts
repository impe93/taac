/**
 * SummaryService — meeting/media summarization.
 *
 * Inverted map-reduce:
 *   0. speaker resolution — one call that names the diarizer's clusters from the
 *      words actually spoken, merging clusters that turn out to be one person
 *   1. map   — each transcript chunk produces the FINAL "## Details" bullets for
 *              its own topics, plus candidate follow-up tasks
 *   2. reduce— the topic outline produces only the opening sections
 *   3. assemble — headings and details are written by code, not by the model
 *
 * The point of the inversion: the per-topic detail budget now grows with the
 * length of the meeting, instead of every section competing for one fixed output
 * allowance that a long meeting always exhausts before the end.
 *
 * §3.1  Singleton with private constructor + getInstance()
 * §3.7  All log lines are prefixed with [SummaryService]
 */

import type { ActionItem, Speaker, TranscriptionSegment } from '../../../preload/types'
import { AIManager } from '../../ai/AIManager'
import type { ChatMessage } from '../../ai/AIManager'
import { ModelRegistry } from '../../ai/ModelRegistry'
import { getLanguageName } from '../language'
import type { ProcessingProgress } from '../types'
import { parseActionItems } from './actionItems'
import { assembleDocument, buildFallbackContent, isValidSummary } from './assembler'
import { resolveSummaryBudget } from './budgets'
import {
  buildDetailsOutline,
  dedupeAdjacentBullets,
  enforceMonotonic,
  parseMapOutput,
  renderCandidateActions,
  snapTimestamps
} from './detailsParser'
import {
  buildMapSystemPrompt,
  buildMapUserPrompt,
  buildReduceSystemPrompt,
  buildReduceUserPrompt,
  buildSpeakerSystemPrompt,
  buildSpeakerUserPrompt
} from './prompts'
import { applySpeakerNames, parseSpeakerMappings, validateMappings } from './speakerResolution'
import {
  anonymousLabelMap,
  buildSpeakerEvidenceSample,
  chunkTurns,
  genericSpeakers,
  mergeIntoTurns,
  renderTurns
} from './transcriptFormat'
import type {
  CandidateAction,
  DetailBullet,
  SpeakerResolutionResult,
  SummaryBudget,
  SummaryContentType,
  SummaryDepth,
  SummaryOutcome,
  TokenCounter,
  TranscriptChunk,
  Turn
} from './types'

export interface SummarizeInput {
  speakers: Speaker[]
  segments: TranscriptionSegment[]
  language: string
  contentType: SummaryContentType
  summaryDepth?: SummaryDepth
  onProgress: (progress: ProcessingProgress) => void
  signal?: AbortSignal
}

/** Everything the stages need, so their signatures stay readable. */
interface StageContext {
  aiManager: AIManager
  modelId: string
  budget: SummaryBudget
  languageName: string
  contentType: SummaryContentType
  countTokens: TokenCounter
  onProgress: (progress: ProcessingProgress) => void
}

/** Progress split across the three stages. */
const PROGRESS_SPEAKERS_END = 8
const PROGRESS_MAP_END = 80
const PROGRESS_REDUCE_END = 95

export class SummaryService {
  private static instance: SummaryService | null = null

  // Abort signal for the in-flight summarization. Processing jobs are serialized
  // (one active abort controller in audioHandlers), so a single field is safe.
  private abortSignal?: AbortSignal

  private constructor() {
    // §3.1 — singleton; use SummaryService.getInstance()
  }

  static getInstance(): SummaryService {
    if (!SummaryService.instance) {
      SummaryService.instance = new SummaryService()
    }
    return SummaryService.instance
  }

  /**
   * Summarize a transcript. Never throws: a failure degrades to the full
   * transcript with the reason stated, so a meeting is never lost.
   */
  async summarize(input: SummarizeInput): Promise<SummaryOutcome> {
    const { language, contentType, onProgress, signal } = input
    let speakers = input.speakers
    let segments = input.segments

    let turns = mergeIntoTurns(segments, speakers)
    const transcriptText = renderTurns(turns)

    if (!transcriptText.trim()) {
      const reason = 'No speech was detected in this recording.'
      console.warn('[SummaryService] Empty transcript — skipping summarization')
      return {
        content: buildFallbackContent('', reason, contentType),
        actionItems: [],
        speakers,
        transcription: segments,
        error: reason
      }
    }

    this.abortSignal = signal
    const aiManager = AIManager.getInstance()
    let loadedModelId: string | undefined

    // The strict retry used to re-run the whole pipeline from a low percentage,
    // making the bar jump backwards. Retries are per-stage now, but the clamp
    // stays as a cheap guarantee.
    let progressCeiling = 0
    const monotonicProgress = (progress: ProcessingProgress): void => {
      if (progress.stage === 'summarizing' && typeof progress.progress === 'number') {
        if (progress.progress < progressCeiling) {
          onProgress({ ...progress, progress: progressCeiling })
          return
        }
        progressCeiling = progress.progress
      }
      onProgress(progress)
    }

    try {
      if (!aiManager.isInitialized()) {
        console.log('[SummaryService] AIManager not initialized — initializing now...')
        await aiManager.initialize()
      }

      const budget = await resolveSummaryBudget(input.summaryDepth)
      const modelId = this.getActiveChatModelId(aiManager)
      await aiManager.loadModel(modelId)
      loadedModelId = modelId

      const countTokens = await this.buildTokenCounter(aiManager, modelId, transcriptText)
      console.log(
        `[SummaryService] Start — type=${contentType} model=${modelId} turns=${turns.length} ` +
          `tokens=${countTokens(transcriptText)} context=${budget.contextSize}`
      )

      const ctx: StageContext = {
        aiManager,
        modelId,
        budget,
        languageName: getLanguageName(language),
        contentType,
        countTokens,
        onProgress: monotonicProgress
      }

      // ---- Stage 0: speaker resolution (meetings only) ----
      if (contentType === 'meeting') {
        const resolved = await this.resolveSpeakers(ctx, turns, speakers, segments, transcriptText)
        if (resolved.changed) {
          speakers = resolved.speakers
          segments = resolved.segments
          turns = mergeIntoTurns(segments, speakers)
        }
      }

      // Clusters still unnamed get letter labels, kept distinct so the model can
      // still tell who answers whom, and visibly unlike a real name.
      const labelOverride = anonymousLabelMap(genericSpeakers(speakers))

      // ---- Stage 1: map — the details bullets ----
      const chunks = chunkTurns(turns, budget.chunkInputTokens, countTokens, labelOverride)
      console.log(`[SummaryService] Details map over ${chunks.length} chunk(s)`)
      const { bullets, actions } = await this.runDetailsMap(ctx, chunks)

      const finalBullets = enforceMonotonic(dedupeAdjacentBullets(bullets))
      console.log(
        `[SummaryService] Details complete — ${finalBullets.length} bullet(s), ` +
          `${actions.length} candidate action(s)`
      )

      // ---- Stage 2: reduce — the opening sections ----
      const reduceOutput = await this.runReduce(ctx, finalBullets, actions)

      // ---- Stage 3: assemble ----
      const content = assembleDocument(reduceOutput, finalBullets, contentType)
      const actionItems: ActionItem[] = contentType === 'meeting' ? parseActionItems(content) : []

      monotonicProgress({ stage: 'summarizing', progress: 100, message: 'Summary complete' })

      if (!isValidSummary(content, contentType)) {
        console.warn('[SummaryService] Assembled summary looks incomplete — keeping it anyway')
        return {
          content,
          actionItems,
          speakers,
          transcription: segments,
          error: 'The automatic summary may be incomplete — some sections could be missing.'
        }
      }

      console.log(`[SummaryService] Summarization complete (${content.length} chars)`)
      return { content, actionItems, speakers, transcription: segments }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[SummaryService] Summarization failed: ${msg}`)
      if (err instanceof Error && err.stack) console.error(`[SummaryService] Stack: ${err.stack}`)
      return {
        content: buildFallbackContent(
          transcriptText,
          `Automatic summarization failed: ${msg}. The full transcript is preserved below.`,
          contentType
        ),
        actionItems: [],
        speakers,
        transcription: segments,
        error: msg
      }
    } finally {
      this.abortSignal = undefined
      // Free the chat model right after the meeting (success OR failure) so
      // ~2.7GB is not held until the 5-minute idle unload.
      if (loadedModelId) {
        try {
          await aiManager.unloadModel(loadedModelId)
          console.log(`[SummaryService] Unloaded chat model: ${loadedModelId}`)
        } catch (e) {
          console.error('[SummaryService] Failed to unload chat model:', e)
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Stages
  // -------------------------------------------------------------------------

  /**
   * Name the diarizer's clusters from the transcript itself.
   *
   * Best-effort by design: any failure logs and leaves the labels untouched.
   * Skipped entirely when no label still looks auto-generated, which also stops
   * a regeneration from overwriting names the user already corrected.
   */
  private async resolveSpeakers(
    ctx: StageContext,
    turns: Turn[],
    speakers: Speaker[],
    segments: TranscriptionSegment[],
    transcriptText: string
  ): Promise<SpeakerResolutionResult> {
    const targets = genericSpeakers(speakers)
    if (targets.length === 0) {
      console.log('[SummaryService] Speakers already named — skipping resolution')
      return { speakers, segments, changed: false }
    }

    ctx.onProgress({
      stage: 'summarizing',
      progress: 2,
      message: 'Identifying participants...'
    })

    try {
      const sample = buildSpeakerEvidenceSample(
        turns,
        ctx.budget.speakerInputTokens,
        ctx.countTokens
      )
      if (!sample.trim()) return { speakers, segments, changed: false }

      const tags = targets.map((s) => s.label)
      const raw = await this.runChat(
        ctx,
        buildSpeakerSystemPrompt(),
        buildSpeakerUserPrompt(tags, sample),
        ctx.budget.speakerOutputTokens
      )

      const parsed = parseSpeakerMappings(raw, tags)
      const validated = validateMappings(parsed, transcriptText)
      if (validated.length === 0) {
        console.log('[SummaryService] No speaker name could be verified — keeping labels')
        return { speakers, segments, changed: false }
      }

      const result = applySpeakerNames(speakers, segments, validated)
      console.log(
        `[SummaryService] Speakers resolved — ${validated.length} named, ` +
          `${speakers.length} cluster(s) → ${result.speakers.length}`
      )
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // An abort must stop the whole job, not degrade to unnamed speakers.
      if (this.abortSignal?.aborted) throw err
      console.warn(`[SummaryService] Speaker resolution failed — keeping labels: ${msg}`)
      return { speakers, segments, changed: false }
    }
  }

  /**
   * Map step: one call per chunk, each producing the final bullets for its own
   * topics. A chunk that yields nothing is retried once, then replaced by a
   * placeholder — one bad chunk must not sink the meeting.
   */
  private async runDetailsMap(
    ctx: StageContext,
    chunks: TranscriptChunk[]
  ): Promise<{ bullets: DetailBullet[]; actions: CandidateAction[] }> {
    const systemPrompt = buildMapSystemPrompt(ctx.languageName, ctx.contentType)
    const bullets: DetailBullet[] = []
    const actions: CandidateAction[] = []
    let previousTitles: string[] = []

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const userPrompt = buildMapUserPrompt(
        chunk,
        i,
        chunks.length,
        previousTitles,
        ctx.contentType
      )

      let parsed = parseMapOutput(
        await this.runChat(ctx, systemPrompt, userPrompt, ctx.budget.mapOutputTokens)
      )

      if (parsed.bullets.length === 0) {
        console.warn(
          `[SummaryService] Chunk ${i + 1}/${chunks.length} produced no bullet — retrying`
        )
        parsed = parseMapOutput(
          await this.runChat(ctx, systemPrompt, userPrompt, ctx.budget.mapOutputTokens)
        )
      }

      const chunkBullets =
        parsed.bullets.length > 0
          ? snapTimestamps(parsed.bullets, chunk)
          : [
              {
                title: 'Discussion',
                body: '_This part of the recording could not be summarized._',
                startTime: chunk.startTime
              }
            ]

      bullets.push(...chunkBullets)
      actions.push(...parsed.actions)
      previousTitles = chunkBullets.slice(-2).map((b) => b.title)

      console.log(
        `[SummaryService] Chunk ${i + 1}/${chunks.length} — ` +
          `bullets=${chunkBullets.length} actions=${parsed.actions.length}`
      )

      const span = PROGRESS_MAP_END - PROGRESS_SPEAKERS_END
      ctx.onProgress({
        stage: 'summarizing',
        progress: PROGRESS_SPEAKERS_END + Math.round(((i + 1) / chunks.length) * span),
        message: `Summarizing topics (${i + 1}/${chunks.length})...`
      })
    }

    return { bullets, actions }
  }

  /** Reduce step: the opening sections, written from the topic outline. */
  private async runReduce(
    ctx: StageContext,
    bullets: DetailBullet[],
    actions: CandidateAction[]
  ): Promise<string> {
    const systemPrompt = buildReduceSystemPrompt(ctx.languageName, ctx.contentType)
    const actionsText = ctx.contentType === 'meeting' ? renderCandidateActions(actions) : ''
    // Candidate actions are short and must survive verbatim — the outline gets
    // whatever budget is left after them.
    const outlineBudget = Math.max(512, ctx.budget.reduceInputTokens - ctx.countTokens(actionsText))
    const outline = buildDetailsOutline(bullets, outlineBudget, ctx.countTokens)

    const userPrompt = buildReduceUserPrompt(outline, actionsText, ctx.contentType)
    const run = (): Promise<string> =>
      this.runChat(
        ctx,
        systemPrompt,
        userPrompt,
        ctx.budget.reduceOutputTokens,
        PROGRESS_MAP_END,
        PROGRESS_REDUCE_END,
        'Writing summary...'
      )

    const output = await run()
    if (output.trim()) return output

    console.warn('[SummaryService] Reduce produced no output — retrying once')
    return run()
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Run a single isolated chat completion and return the cleaned text. */
  private async runChat(
    ctx: StageContext,
    systemPrompt: string,
    userMessage: string,
    maxTokens: number,
    progressFrom?: number,
    progressTo?: number,
    progressMessage?: string
  ): Promise<string> {
    // Don't start a new generation once the job is aborted.
    if (this.abortSignal?.aborted) throw new Error('Summarization aborted')

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ]

    const generator = ctx.aiManager.generateChatCompletion(
      ctx.modelId,
      messages,
      {
        isolated: true,
        maxTokens,
        contextSize: ctx.budget.contextSize,
        // Disable reasoning: Qwen3.5's default thought budget (~75% of context)
        // can consume the entire maxTokens allowance before any structured
        // output is emitted, producing an empty result.
        thoughtTokens: 0,
        // Low temperature for stable adherence to the required output format.
        temperature: 0.3
      },
      this.abortSignal
    )

    let fullContent = ''
    let chunkCount = 0
    for await (const chunk of generator) {
      fullContent += chunk
      chunkCount++
      if (progressFrom !== undefined && progressTo !== undefined && chunkCount % 20 === 0) {
        const span = progressTo - progressFrom
        ctx.onProgress({
          stage: 'summarizing',
          progress: Math.round(progressFrom + Math.min(span, chunkCount / 3)),
          message: progressMessage ?? 'Generating summary...'
        })
      }
    }

    // Defensively strip any reasoning block a model might leak into the response.
    return fullContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  }

  /**
   * Build a synchronous token counter, backend-aware:
   * - GGUF (node-llama-cpp): exact `model.tokenize().length`.
   * - MLX (Python sidecar): tokenizing every chunk over IPC would be slow, so we
   *   calibrate a chars-per-token ratio from ONE exact count and estimate from
   *   string length. The budgets carry ≥40% headroom, so an estimate is enough.
   */
  private async buildTokenCounter(
    aiManager: AIManager,
    modelId: string,
    calibrationText: string
  ): Promise<TokenCounter> {
    if (ModelRegistry.getModel(modelId)?.format === 'mlx') {
      const total = await aiManager.countTokens(modelId, calibrationText)
      const charsPerToken = calibrationText.length / Math.max(1, total)
      return (text: string): number => Math.ceil(text.length / Math.max(charsPerToken, 1e-6))
    }
    const model = await aiManager.getModelInstance(modelId)
    return (text: string): number => model.tokenize(text).length
  }

  /**
   * ID of the first loaded chat model, or the hardware-resolved default. Reusing
   * a model already in memory avoids a redundant load.
   */
  private getActiveChatModelId(aiManager: AIManager): string {
    const chatModel = aiManager
      .getLoadedModels()
      .find((m) => ModelRegistry.getModel(m.id)?.capabilities.includes('chat'))
    return chatModel?.id ?? aiManager.getDefaultChatModelId()
  }
}
