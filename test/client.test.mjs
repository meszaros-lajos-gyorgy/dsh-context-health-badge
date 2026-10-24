/**
 * Unit test for the browser half. Runs without a browser or test framework:
 * the closure factory is evaluated in a VM with a fake module table, then the
 * registered component is server-rendered against projection fixtures.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { dirname, resolve } from 'node:path'
import {
  HEALTH_KEY, repetitionScore as hostRepetitionScore, threadHealthProjection,
} from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolve(here, '..', 'client.js')
const source = readFileSync(bundlePath, 'utf8')

// The repository checkout ships React in its pnpm store; the plugin itself
// never resolves it (the browser module table supplies it at runtime).
const React = createRequire('/home/lali/deepseek-harness/node_modules/.pnpm/react@18.3.1/node_modules/react/package.json')('react')
const { renderToStaticMarkup } = createRequire(
  '/home/lali/deepseek-harness/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/package.json',
)('react-dom/server')

let registration
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(definition) {
        registration = definition
      },
    },
  },
  console,
}
runInContext(source, createContext(sandbox), { filename: bundlePath })

assert.equal(registration.id, 'dsh-context-health-badge', 'bundle registers its package id')
assert.equal(typeof registration.factory, 'function', 'bundle exposes a closure factory')

const plugin = registration.factory((specifier) => {
  if (specifier === 'react') return React
  if (specifier === 'react-dom') return { createPortal: node => node }
  throw new Error(`unexpected module request: ${specifier}`)
})

assert.equal(plugin.name, 'context-health-badge')
assert.equal(plugin.inject.join(','), 'slots')
assert.equal(typeof plugin.apply, 'function')

let component
let registered
const injected = []
const ctx = {
  slots: {
    inject(key, callback) {
      injected.push(key)
      return callback()
    },
    register(options, value) {
      registered = options
      component = value
      return () => {}
    },
  },
}
plugin.apply(ctx)

assert.equal(injected.join(','), 'conversation.composer.dock')
assert.equal(registered.name, 'conversation.composer.dock')
assert.equal(registered.id, 'context-health-badge')
assert.equal(typeof component, 'function')

/** Render the badge with one projection fixture (no Chat health prop). */
function render(pressure) {
  return renderToStaticMarkup(React.createElement(component, {
    useProjection: key => key === 'contextPressure' ? pressure : undefined,
  }))
}

/** Render the badge with the Chat snapshot and optional token-usage projection. */
function renderWith({ pressure, usage, nodes = [], partial = null }) {
  return renderToStaticMarkup(React.createElement(component, {
    useProjection: key => key === 'contextPressure'
      ? pressure
      : key === 'tokenUsage' ? usage : undefined,
    useChat: selector => selector({ legacy: { nodes, partial } }),
  }))
}

/** Render the badge with the host health projection instead of the Chat fallback. */
function renderProjected({ pressure, usage, health }) {
  return renderToStaticMarkup(React.createElement(component, {
    useProjection: key => key === 'contextPressure'
      ? pressure
      : key === 'tokenUsage' ? usage : key === 'contextHealthBadge' ? health : undefined,
  }))
}

/** A landed compaction marker as the Chat window exposes it. */
function compaction(shadowedTokenCount, minutesAgo) {
  return { kind: 'compaction', time: Date.now() - minutesAgo * 60_000, shadowedTokenCount }
}

/** A finalized Assistant node carrying one reasoning block. */
function assistant(text) {
  return { kind: 'assistant', blocks: [{ kind: 'reasoning', text }] }
}

// Twelve ordinary words repeated ten times: high repetition of the sentence,
// low share of any single word (about 8%), so the detector stays quiet.
const NORMAL_REASONING = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu '.repeat(10)
const REPEATED_REASONING = 'the '.repeat(250)

// readOccupancy contracts.
assert.equal(plugin.readOccupancy(undefined), null)
assert.equal(plugin.readOccupancy({}), null)
assert.equal(plugin.readOccupancy({ pressureTokens: 1_000 }), null)
assert.equal(plugin.readOccupancy({ pressureTokens: 1_000, contextWindow: 0 }), null)
assert.equal(
  JSON.stringify(plugin.readOccupancy({ pressureTokens: 46_000, contextWindow: 128_000 })),
  JSON.stringify({ percent: 36, usedTokens: 46_000, contextWindow: 128_000 }),
)
assert.equal(
  JSON.stringify(plugin.readOccupancy({ pressureTokens: 50_000, projectedTokens: 51_200, contextWindow: 128_000 })),
  JSON.stringify({ percent: 40, usedTokens: 51_200, contextWindow: 128_000 }),
)
assert.equal(
  plugin.readOccupancy({ pressureTokens: 300_000, contextWindow: 128_000 }).percent,
  100,
  'percent clamps to 100',
)

// formatTokens contracts.
assert.equal(plugin.formatTokens(940), '940')
assert.equal(plugin.formatTokens(1_000), '1K')
assert.equal(plugin.formatTokens(45_200), '45.2K')
assert.equal(plugin.formatTokens(128_000), '128K')
assert.equal(plugin.formatTokens(1_250_000), '1.25M')

// No capacity yet: render nothing rather than a misleading zero.
assert.equal(render(undefined), '')
assert.equal(render({ pressureTokens: 1_000 }), '')

// A normal reading sits in the neutral tone.
const neutral = render({ pressureTokens: 46_000, contextWindow: 128_000 })
assert.match(neutral, /data-tone="neutral"/)
assert.match(neutral, />ctx</)
assert.match(neutral, />36%</)
assert.match(neutral, /role="meter"/)
assert.match(neutral, /aria-valuenow="36"/)
assert.match(neutral, /aria-valuetext="36% \(~46K of 128K tokens\)"/)
assert.doesNotMatch(neutral, / title=/)
assert.match(neutral, /stroke-dasharray="13\.571680263507906 37\.69911184307752"/)

// Thresholds: 70% warns, 90% is danger, and the ring tracks projectedTokens.
assert.match(
  render({ pressureTokens: 89_600, contextWindow: 128_000 }),
  /data-tone="warn"/,
)
assert.match(
  render({ pressureTokens: 115_200, contextWindow: 128_000 }),
  /data-tone="danger"/,
)
assert.match(render({ pressureTokens: 10_000, projectedTokens: 51_200, contextWindow: 128_000 }), />40%</)

// A full context still renders a full ring.
const full = render({ pressureTokens: 128_000, contextWindow: 128_000 })
assert.match(full, />100%</)
assert.match(full, /aria-valuenow="100"/)

// Health helpers: repetition score, compaction fold, and tone selection.
assert.equal(plugin.repetitionScore(undefined), 0)
assert.equal(plugin.repetitionScore('short text'), 0)
assert.ok(plugin.repetitionScore(REPEATED_REASONING) > 0.95, 'a wall of "the" scores at the top')
assert.ok(plugin.repetitionScore(NORMAL_REASONING) < 0.2, 'ordinary prose stays low')

const folded = plugin.deriveHealth([
  compaction(425_160, 600),
  compaction(403_190, 1_200),
  assistant(NORMAL_REASONING),
], null)
assert.equal(folded.available, true)
assert.equal(folded.compactions, 2)
assert.equal(folded.shadowedTokens, 828_350)
assert.ok(folded.repetition < 0.2)
assert.equal(plugin.deriveHealth(undefined, null).available, false)

assert.equal(plugin.healthTone(63, { compactions: 2, repetition: 0 }), 'warn')
assert.equal(plugin.healthTone(63, { compactions: 0, repetition: 0 }), 'neutral')
assert.equal(plugin.healthTone(17, { compactions: 0, repetition: 0.5 }), 'danger')
assert.equal(plugin.healthTone(17, { compactions: 0, repetition: 0.45 }), 'danger')
assert.equal(plugin.healthTone(17, { compactions: 3, repetition: 0 }), 'danger')
assert.equal(plugin.healthTone(17, { compactions: 0, repetition: 0.31 }), 'neutral')

// The archived "Arx Fatalis" shape: 63% with two compactions is a warning even
// though the raw percentage is below the old 70% threshold.
const twoCompactions = renderWith({
  pressure: { pressureTokens: 634_000, contextWindow: 1_000_000 },
  nodes: [compaction(425_160, 600), compaction(403_190, 1_200), assistant(NORMAL_REASONING)],
})
assert.match(twoCompactions, /data-tone="warn"/)
assert.match(twoCompactions, /· 2C/)
assert.match(twoCompactions, /aria-valuetext="63% \(~634K of 1M tokens\), 2 compactions"/)

// Three compactions reach the danger tone on their own.
assert.match(
  renderWith({
    pressure: { pressureTokens: 634_000, contextWindow: 1_000_000 },
    nodes: [compaction(1, 1), compaction(1, 2), compaction(1, 3), assistant(NORMAL_REASONING)],
  }),
  /data-tone="danger"/,
)

// Repetition at 17.6% is already fatal: no 90% threshold needed.
const repeated = renderWith({
  pressure: { pressureTokens: 176_185, contextWindow: 1_000_000 },
  nodes: [assistant(REPEATED_REASONING)],
})
assert.match(repeated, /data-tone="danger"/)
assert.match(repeated, /⚠/)
assert.match(repeated, /aria-valuetext="18% \(~176.2K of 1M tokens\), repetition warning"/)

// A live partial reasoning block overrides the last finalized Assistant.
assert.match(
  renderWith({
    pressure: { pressureTokens: 176_185, contextWindow: 1_000_000 },
    nodes: [assistant(NORMAL_REASONING)],
    partial: { blocks: [{ kind: 'reasoning', text: REPEATED_REASONING }] },
  }),
  /data-tone="danger"/,
)

// Tooltip rows: separated lines with a bold label and a warning-colored
// health line. The 5px gap and 600 weight are CSS; this covers the data.
const twoRows = plugin.tooltipRows(
  { percent: 63, usedTokens: 634_000, contextWindow: 1_000_000 },
  {
    available: true, exact: true, compactions: 2, shadowedTokens: 828_350,
    lastCompactionTime: Date.now() - 3_600_000, repetition: 0.09,
  },
  '634K', '1M', null, 0, 'warn',
)
assert.equal(twoRows.length, 4)
assert.equal(twoRows[0].label, 'Context window:')
assert.equal(twoRows[0].text, '~634K / 1M tokens (63%)')
assert.equal(twoRows[0].tone, null)
assert.equal(twoRows[1].label, 'Compactions:')
assert.match(twoRows[1].text, /^2 · ~828.4K tokens compacted · last 1h ago$/)
assert.equal(twoRows[2].label, 'Thread health:')
assert.equal(twoRows[2].tone, 'warn')
assert.match(twoRows[2].text, /^2 compactions/)
assert.match(twoRows[2].text, /max word share 9%/)
assert.equal(twoRows[3].label, 'Recommendation:')
assert.match(twoRows[3].text, /consider a fresh thread/)

const dangerRows = plugin.tooltipRows(
  { percent: 18, usedTokens: 176_185, contextWindow: 1_000_000 },
  {
    available: true, exact: true, compactions: 0, shadowedTokens: 0,
    lastCompactionTime: null, repetition: 1,
  },
  '176.2K', '1M', null, 0, 'danger',
)
assert.equal(dangerRows[2].tone, 'danger')
assert.match(dangerRows[2].text, /repetition detected/)
assert.equal(dangerRows[3].label, 'Recommendation:')
assert.match(dangerRows[3].text, /fork or start a fresh thread/)

// The context line itself is tinted when the raw percentage warns.
const warnPercentRows = plugin.tooltipRows(
  { percent: 85, usedTokens: 850_000, contextWindow: 1_000_000 },
  { available: false },
  '850K', '1M', null, 0, 'warn',
)
assert.equal(warnPercentRows.length, 1)
assert.equal(warnPercentRows[0].tone, 'warn')
const dangerPercentRows = plugin.tooltipRows(
  { percent: 95, usedTokens: 950_000, contextWindow: 1_000_000 },
  { available: false },
  '950K', '1M', null, 0, 'danger',
)
assert.equal(dangerPercentRows[0].tone, 'danger')

// Without the Chat prop the badge stays a plain occupancy meter.
assert.doesNotMatch(neutral, /Compactions:/)
assert.doesNotMatch(neutral, /Thread health:/)

// The host projection is the exact source: three compactions and the latest
// repetition survive even when the Chat window contains no compaction marker.
const exact = renderProjected({
  pressure: { pressureTokens: 266_300, contextWindow: 1_000_000 },
  health: {
    compactions: 3,
    shadowedTokens: 1_238_971,
    lastCompactionTime: Date.now() - 3_600_000,
    repetition: 0.51,
  },
})
assert.match(exact, /data-tone="danger"/)
assert.match(exact, /· 3C/)
const exactRows = plugin.tooltipRows(
  { percent: 27, usedTokens: 266_300, contextWindow: 1_000_000 },
  {
    available: true, exact: true, compactions: 3, shadowedTokens: 1_238_971,
    lastCompactionTime: Date.now() - 3_600_000, repetition: 0.45,
  },
  '266.3K', '1M', null, 0, 'danger',
)
assert.match(exactRows[1].text, /^3 · ~1.24M tokens compacted · last 1h ago$/)
assert.equal(exactRows[2].tone, 'danger')
assert.match(exactRows[2].text, /repetition detected/)
assert.match(exactRows[3].text, /fork or start a fresh thread; compaction does not reset a repetition loop/)

// A zero-compaction projection says none without the Chat-window caveat.
const exactNone = renderProjected({
  pressure: { pressureTokens: 266_300, contextWindow: 1_000_000 },
  health: { compactions: 0, shadowedTokens: 0, lastCompactionTime: null, repetition: 0 },
})
assert.doesNotMatch(exactNone, /· 0C/)
const noneRows = plugin.tooltipRows(
  { percent: 27, usedTokens: 266_300, contextWindow: 1_000_000 },
  {
    available: true, exact: true, compactions: 0, shadowedTokens: 0,
    lastCompactionTime: null, repetition: 0,
  },
  '266.3K', '1M', null, 0, 'neutral',
)
assert.equal(noneRows[1].text, 'none')

// The cumulative token projection appears in the tooltip as thread age.
const processedRows = plugin.tooltipRows(
  { percent: 63, usedTokens: 634_000, contextWindow: 1_000_000 },
  {
    available: true, exact: true, compactions: 1, shadowedTokens: 410_621,
    lastCompactionTime: null, repetition: 0,
  },
  '634K', '1M', 382_000_000, 382, 'neutral',
)
const processedRow = processedRows.find(row => row.key === 'processed')
assert.ok(processedRow)
assert.equal(processedRow.label, 'Processed:')
assert.equal(processedRow.text, '~382M tokens (382× window)')

// Host repetition uses the same algorithm as the browser fallback.
assert.equal(HEALTH_KEY, 'contextHealthBadge')
assert.equal(
  hostRepetitionScore(REPEATED_REASONING),
  plugin.repetitionScore(REPEATED_REASONING),
)
assert.ok(hostRepetitionScore(NORMAL_REASONING) < 0.2)

// Host fold: compaction accounting, repetition, stable references, restore.
const empty = threadHealthProjection.init()
assert.equal(empty.view.compactions, 0)
assert.equal(empty.view.repetition, 0)
const firstCompaction = threadHealthProjection.apply(empty, {
  type: 'compaction/summary', time: 1_000, data: { shadowedTokenCount: 403_190 },
})
assert.notEqual(firstCompaction, empty)
assert.equal(firstCompaction.view.compactions, 1)
assert.equal(firstCompaction.view.shadowedTokens, 403_190)
assert.equal(firstCompaction.view.lastCompactionTime, 1_000)
const three = [1, 2].reduce(
  state => threadHealthProjection.apply(state, {
    type: 'compaction/summary', time: 2_000, data: { shadowedTokenCount: 10 },
  }),
  firstCompaction,
)
assert.equal(three.view.compactions, 3)
assert.equal(three.view.shadowedTokens, 403_210)
const hostBad = threadHealthProjection.apply(three, {
  type: 'assistant/message',
  data: { message: { content: [{ type: 'reasoning', text: REPEATED_REASONING }] } },
})
assert.equal(hostBad.view.repetition, 1)
assert.equal(threadHealthProjection.apply(hostBad, { type: 'step/start', data: {} }), hostBad)
assert.equal(threadHealthProjection.apply(hostBad, {
  type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'short' }] } },
}), hostBad)
const restored = threadHealthProjection.stateSchema.parse({
  compactions: 2, shadowedTokens: 5, lastCompactionTime: 123, repetition: 0.4,
})
assert.equal(restored.view.compactions, 2)
assert.equal(restored.view.shadowedTokens, 5)
assert.equal(restored.view.repetition, 0.4)

console.log('context-health-badge: all assertions passed')
