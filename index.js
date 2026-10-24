/**
 * Host half of dsh-context-health-badge.
 *
 * The browser cannot see compactions outside its loaded Chat window, so this
 * half registers a `contextHealthBadge` Session projection: one synchronous
 * fold over the complete durable log that carries the exact compaction count,
 * the compacted token total, the last compaction time, and the repetition
 * score of the latest Assistant reasoning. The browser reads that projection
 * through the standard `useProjection` prop; the fold is driven eagerly by the
 * session-projection registry, so history replay and live events share one
 * implementation.
 *
 * Repetition is the largest share of one word inside a sliding 100-word
 * window. Normal English prose keeps its stop-word share around 5–8%;
 * degenerate reasoning ("the the the …") climbs past 30–50%. The score is
 * language-agnostic: it assumes word boundaries, not an English vocabulary.
 */

/** Projection key the browser reads; distinct from the token-meter keys. */
export const HEALTH_KEY = 'contextHealthBadge'

/** Thresholds shared with the browser bundle's fallback detector. */
const REPEAT_WINDOW = 100
const REPEAT_STEP = 20

/** Words separated by the runtime's Unicode word boundaries. */
const WORD_RE = /[\p{L}\p{N}_']+/gu

/**
 * Measure the worst repetition inside one text.
 * @param {string} text - reasoning (or answer) text to inspect.
 * @returns {number} 0–1, 0 for text too short to judge.
 */
export function repetitionScore(text) {
  if (typeof text !== 'string' || text.length < 200) return 0
  const words = text.toLowerCase().match(WORD_RE)
  if (words === null || words.length < REPEAT_WINDOW) return 0
  let worst = 0
  for (let start = 0; start + REPEAT_WINDOW <= words.length; start += REPEAT_STEP) {
    const counts = new Map()
    let top = 0
    for (let index = start; index < start + REPEAT_WINDOW; index += 1) {
      const word = words[index]
      const count = (counts.get(word) ?? 0) + 1
      counts.set(word, count)
      if (count > top) top = count
    }
    const share = top / REPEAT_WINDOW
    if (share > worst) worst = share
  }
  return worst
}

/** The wire view the browser reads: plain JSON numbers and null. */
function makeView(state) {
  return {
    compactions: state.compactions,
    shadowedTokens: state.shadowedTokens,
    lastCompactionTime: state.lastCompactionTime,
    repetition: state.repetition,
  }
}

/**
 * Normalize a state object, whether it comes from `init()` or a persisted
 * projection checkpoint. The view is rebuilt so its identity tracks this
 * state instance.
 * @param {object|undefined} source - candidate state.
 * @returns {object} complete state plus its `view`.
 */
function createState(source) {
  const value = source !== null && typeof source === 'object' ? source : {}
  const state = {
    compactions: Number.isInteger(value.compactions) && value.compactions >= 0 ? value.compactions : 0,
    shadowedTokens: typeof value.shadowedTokens === 'number' && value.shadowedTokens >= 0 ? value.shadowedTokens : 0,
    lastCompactionTime: typeof value.lastCompactionTime === 'number' ? value.lastCompactionTime : null,
    repetition: typeof value.repetition === 'number' && value.repetition >= 0 && value.repetition <= 1
      ? value.repetition
      : 0,
  }
  state.view = makeView(state)
  return state
}

/**
 * Select the reasoning (or answer) text of one durable Assistant settlement.
 * @param {object} event - session event.
 * @returns {string} text to score.
 */
function assistantText(event) {
  const content = event?.data?.message?.content
  if (!Array.isArray(content)) return ''
  const reasoning = []
  const answer = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'reasoning' && typeof block.text === 'string') reasoning.push(block.text)
    else if (block.type === 'text' && typeof block.text === 'string') answer.push(block.text)
  }
  const thought = reasoning.join('\n')
  return thought.length >= 200 ? thought : answer.join('\n')
}

/**
 * The projection unit. `apply` returns the same state reference for events it
 * does not own, so the registry's identity gate skips downstream work.
 */
export const threadHealthProjection = {
  key: HEALTH_KEY,
  stateVersion: 1,
  stateSchema: { parse: value => createState(value) },
  init: () => createState(undefined),
  apply: (state, event) => {
    if (event?.type === 'compaction/summary') {
      const shadowed = event.data?.shadowedTokenCount
      const next = {
        ...state,
        compactions: state.compactions + 1,
        shadowedTokens: state.shadowedTokens
          + (typeof shadowed === 'number' && shadowed >= 0 ? shadowed : 0),
        lastCompactionTime: typeof event.time === 'number' ? event.time : state.lastCompactionTime,
      }
      next.view = makeView(next)
      return next
    }
    if (event?.type === 'assistant/message') {
      const text = assistantText(event)
      if (text.length < 200) return state
      const repetition = repetitionScore(text)
      if (repetition === state.repetition) return state
      const next = { ...state, repetition }
      next.view = makeView(next)
      return next
    }
    return state
  },
  wire: {
    viewSchema: { parse: value => value },
    view: state => state.view,
  },
}

export const name = 'context-health-badge'
export const inject = ['sessionProjections']

/**
 * Register the health projection. The projection registry drives it eagerly
 * over every committed session event; its registration is tied to this fiber.
 * @param {object} ctx - host Context carrying the session-projection service.
 */
export function apply(ctx) {
  ctx.sessionProjections.register(threadHealthProjection)
}
