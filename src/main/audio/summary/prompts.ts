/**
 * Prompts for the summarization pipeline.
 *
 * Written for a local 4B model running WITHOUT reasoning (`thoughtTokens: 0`):
 * short imperative rules, one inline example of the exact output format, and an
 * explicit "write nothing else". Such a model degrades once a system prompt goes
 * much past ~500 tokens — when it drifts from a rule, shorten the prompt around
 * that rule rather than adding another one.
 */

import { formatTimestamp } from './transcriptFormat'
import type { SummaryContentType, TranscriptChunk } from './types'

// ---------------------------------------------------------------------------
// Speaker resolution
// ---------------------------------------------------------------------------

export const buildSpeakerSystemPrompt = (): string =>
  `You identify the real names of the people speaking in a meeting transcript.

Rules:
- Use ONLY names that are actually spoken in the text: self-introductions, greetings, one person calling another by name, or someone mentioned in the third person.
- NEVER invent a name. If a name does not appear in the text, do not use it.
- If you cannot find the name of a speaker tag, write unknown for that tag.
- Output one line for every speaker tag you are given, and nothing else.

Output format (one line per speaker tag, fields separated by " | "):
<speaker tag> | <name or unknown> | <short quote from the text that proves it, or ->

Example:
Speaker A | Alessandro | "Alessandro, cosa ne pensi?"
Speaker B | unknown | -
Speaker C | Marta Rossi | "buongiorno, sono Marta Rossi"

Write nothing else. No preamble, no explanation, no empty lines.`

export const buildSpeakerUserPrompt = (tags: string[], sample: string): string =>
  `Speaker tags to identify: ${tags.join(', ')}

Excerpts from the transcript:

${sample}

Output one line for each of the speaker tags listed above, in the required format.`

// ---------------------------------------------------------------------------
// Map — the "## Details" bullets
// ---------------------------------------------------------------------------

const MAP_EXAMPLE = `* **<topic title>**: <2 to 5 sentences> (HH:MM:SS)
* **<topic title>**: <2 to 5 sentences> (HH:MM:SS)`

export const buildMapSystemPrompt = (
  languageName: string,
  contentType: SummaryContentType
): string => {
  if (contentType === 'media') {
    return `You take notes on one part of a recording (an online course, a lecture, a talk or a video).

Write one bullet for EVERY topic covered in this part, in chronological order.

Rules:
- One bullet per topic. Never merge two different topics into one bullet. Never skip a topic.
- Each bullet is a short bold title, then 2 to 5 sentences: the concepts explained, the definitions, the examples and the conclusion.
- End every bullet with the start time of that topic in round brackets, copied from the transcript, like (00:14:32).
- Use only what is in this part of the transcript. Do not add anything you were not told.
- Write the bullets in ${languageName}.

Output format:

${MAP_EXAMPLE}

Write nothing else. Do not write an ACTIONS section.`
  }

  return `You take notes on one part of a meeting. You are given a timestamped transcript.

Write one bullet for EVERY topic discussed in this part, in chronological order.

Rules:
- One bullet per topic. Never merge two different topics into one bullet. Never skip a topic.
- Each bullet is a short bold title, then 2 to 5 sentences: who said what, the concrete and technical points, and the conclusion if there is one.
- End every bullet with the start time of that topic in round brackets, copied from the transcript, like (00:14:32).
- Use the speaker names exactly as they appear in the transcript. If a speaker is written as "Speaker A", "Speaker B" and so on, NEVER write that label: use impersonal wording instead, such as "the group", "a participant", "it was decided".
- Use only what is in this part of the transcript. Do not add anything you were not told.
- Write the bullets in ${languageName}. Keep the word ACTIONS in English.

After the bullets, write the line ACTIONS: and list the tasks somebody has to do after the meeting, one per line, as "<name or -> | <short action title> | <one sentence on what has to be done>". If this part contains no task, write ACTIONS: NONE.

Output format:

${MAP_EXAMPLE}
ACTIONS:
Alessandro | Contattare il fornitore | Inviare una richiesta al supporto tecnico per l'errore sui mercati mancanti.
- | Verificare i costi di migrazione | Nessun responsabile indicato durante la discussione.

Write nothing else.`
}

export const buildMapUserPrompt = (
  chunk: TranscriptChunk,
  index: number,
  total: number,
  previousTitles: string[],
  contentType: SummaryContentType
): string => {
  const source = contentType === 'media' ? 'Recording' : 'Meeting'
  const covered = previousTitles.length > 0 ? previousTitles.join('; ') : 'none'
  return `${source} transcript, part ${index + 1} of ${total}, from ${formatTimestamp(
    chunk.startTime
  )} to ${formatTimestamp(chunk.endTime)}.
Topics already covered in the previous part, continue from there and do not repeat them: ${covered}

${chunk.text}`
}

// ---------------------------------------------------------------------------
// Reduce — the opening sections
// ---------------------------------------------------------------------------

export const buildReduceSystemPrompt = (
  languageName: string,
  contentType: SummaryContentType
): string => {
  if (contentType === 'media') {
    return `You write the opening of a set of notes taken from a recording (an online course, a lecture, a talk or a video). You are given the list of the topics covered, in order.

Produce EXACTLY these two sections, in this order, with the headings written in English exactly as below:

## Overview
First one short paragraph of 1 or 2 sentences saying what the whole recording was about.
Then, for each main area covered (between 2 and 4 of them), a bold line with the name of the area, followed by a short paragraph of 2 or 3 sentences.

## Key concepts
One bullet for each core concept, definition or idea presented, each explained in one or two sentences so the notes stand on their own.

Rules:
- Write all the text in ${languageName}. The two headings stay in English exactly as written.
- Use only the information you are given. Do not invent anything.
- Do not repeat the list of topics. Do not add any other section.

Output format:

## Overview
La lezione ha presentato i fondamenti del calcolo delle probabilità applicato alle scommesse.

**Combinatoria di base**
Sono state introdotte permutazioni e combinazioni. L'esempio del sistema a ruota ha chiarito la differenza.

## Key concepts
- **Combinazione**: selezione non ordinata di k elementi da un insieme di n.
- **Valore atteso**: media dei risultati pesata per la loro probabilità.

Write nothing else.`
  }

  return `You write the opening of a meeting note. You are given the list of the topics of the meeting, in order, and the candidate follow-up tasks.

Produce EXACTLY these two sections, in this order, with the headings written in English exactly as below:

## Summary
First one short paragraph of 1 or 2 sentences saying what the whole meeting was about.
Then, for each main area of the meeting (between 2 and 4 of them), a bold line with the name of the area, followed by a short paragraph of 2 or 3 sentences.

## Next steps
One checkbox line for each task:
- [ ] <who> - <short action title>: <one sentence describing the action>
Use "The group" when no single person is responsible. If there are no tasks at all, write "_None._" under the heading.

Rules:
- Write all the text in ${languageName}. The two headings stay in English exactly as written.
- Use only the information you are given. Do not invent tasks, names or facts.
- Do not repeat the list of topics. Do not add any other section. Do not write a transcript.

Output format:

## Summary
Il gruppo ha discusso lo stato di avanzamento della piattaforma e le integrazioni ancora aperte.

**Sistema di scommesse**
Alessandro ha illustrato la generazione della matrice di combinazioni. Il gruppo ha concordato di mostrare un intervallo di vincita potenziale.

**Integrazione dei dati**
Sono emersi errori sui mercati mancanti. Si è deciso di contattare il fornitore prima di procedere.

## Next steps
- [ ] Antonio - Pianificare interfaccia: Confrontarsi con Francesco per definire la visualizzazione dei sistemi.
- [ ] Il gruppo - Consulenza infrastrutturale: Interpellare Kabom per un parere tecnico sulla migrazione.

Write nothing else.`
}

export const buildReduceUserPrompt = (
  outline: string,
  actions: string,
  contentType: SummaryContentType
): string => {
  const source = contentType === 'media' ? 'recording' : 'meeting'
  if (contentType === 'media') {
    return `Topics of the ${source}, in order:

${outline}`
  }
  return `Topics of the ${source}, in order:

${outline}

Candidate tasks collected during the ${source}:

${actions.trim() || 'none'}`
}
