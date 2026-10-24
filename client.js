/**
 * Browser half of dsh-context-health-badge.
 *
 * The Web GUI fetches this file through /plugins and executes it as a
 * closure-factory module: `window.__ModuleLoader__.load()` registers the
 * package's exports in the browser module table, and Cordis applies the
 * returned plugin. React is served by that same module table, so the bundle
 * stays dependency-free.
 *
 * The badge reads the `contextPressure` Session projection (registered by
 * @deepseek-ai/dsh-token-meter) through the standard `useProjection` prop that
 * every `session`-scoped slot receives. It renders into
 * `conversation.composer.dock`, the ambient row below the composer card, and
 * pins itself to that row's bottom-right corner.
 */

window.__ModuleLoader__.load({
  id: 'dsh-context-health-badge',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const { useCallback, useEffect, useId, useMemo, useRef, useState } = React
    const { createPortal } = require('react-dom')

    const STYLE_ID = 'dsh-context-health-badge/client.css'
    const CSS = `
.dsh-context-health-badge {
  --dsh-cb-color: var(--dsw-alias-label-secondary);
  --dsh-cb-ring: var(--dsw-alias-label-tertiary);
  position: absolute;
  right: max(
    var(--dsh-composer-dock-inset, 8px),
    calc((100% - var(--dsh-composer-card-max-width, 100%)) / 2 + var(--dsh-composer-dock-inset, 8px))
  );
  bottom: calc(2px + env(safe-area-inset-bottom, 0px));
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px 2px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 72%, transparent);
  color: var(--dsh-cb-color);
  font-family: inherit;
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: default;
  user-select: none;
  transition: background-color 120ms ease;
}

.dsh-context-health-badge:hover,
.dsh-context-health-badge:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-context-health-badge:focus-visible {
  outline: 1px solid var(--dsw-alias-label-tertiary);
  outline-offset: 2px;
}

.dsh-context-health-badge[data-tone='warn'] {
  --dsh-cb-color: var(--dsw-alias-state-warn-label);
  --dsh-cb-ring: var(--dsw-alias-state-warn-primary);
}

.dsh-context-health-badge[data-tone='danger'] {
  --dsh-cb-color: var(--dsw-alias-state-error-primary);
  --dsh-cb-ring: var(--dsw-alias-state-error-primary);
}

.dsh-context-health-badge-ring {
  display: block;
  flex: none;
  overflow: visible;
}

.dsh-context-health-badge-track {
  fill: none;
  stroke: var(--dsw-alias-border-l3);
  stroke-width: 2;
}

.dsh-context-health-badge-fill {
  fill: none;
  stroke: var(--dsh-cb-ring);
  stroke-width: 2;
  stroke-linecap: round;
  transition: stroke-dasharray 180ms ease;
}

.dsh-context-health-badge-label {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.7;
}

.dsh-context-health-badge-value {
  font-weight: 500;
  letter-spacing: 0.01em;
}

.dsh-context-health-badge-meta {
  font-size: 10px;
  font-weight: 500;
  opacity: 0.72;
}

.dsh-context-health-badge-warning {
  font-size: 11px;
  line-height: 1;
}

.dsh-context-health-badge-tooltip {
  position: fixed;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: max-content;
  max-width: min(380px, calc(100vw - 24px));
  padding: 6px 9px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-tooltip-bg);
  color: var(--dsw-static-neutral-bluish-00);
  font-family: inherit;
  font-size: 13px;
  line-height: 20px;
  white-space: normal;
  overflow-wrap: break-word;
  pointer-events: none;
  animation: dsh-context-health-badge-tooltip-in 120ms var(--ds-ease-in-out);
}

.dsh-context-health-badge-tooltip-line {
  display: block;
}

.dsh-context-health-badge-tooltip-label {
  font-weight: 600;
}

.dsh-context-health-badge-tooltip-line[data-tone='warn'] {
  color: var(--dsw-alias-state-warn-primary);
}

.dsh-context-health-badge-tooltip-line[data-tone='danger'] {
  color: var(--dsw-alias-state-error-primary);
}

@keyframes dsh-context-health-badge-tooltip-in {
  from {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-context-health-badge-fill {
    transition: none;
  }

  .dsh-context-health-badge-tooltip {
    animation: none;
  }
}
`

    if (typeof document !== 'undefined'
      && document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-context-health-badge'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /** Ring geometry for a 16px viewBox, 2px stroke. */
    const RADIUS = 6
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS

    /** Warning tone starts here, danger at the second threshold. */
    const WARN_PERCENT = 70
    const DANGER_PERCENT = 90

    /** Repetition thresholds on the largest one-word share inside a 100-word window. */
    const REPEAT_WINDOW = 100
    const REPEAT_STEP = 20
    const REPEAT_WARN = 0.32
    const REPEAT_DANGER = 0.45
    const WORD_RE = /[\p{L}\p{N}_']+/gu

    /**
     * Measure the worst repetition inside one text: the largest share of a
     * single word in any sliding 100-word window. Normal prose stays near the
     * language's stop-word frequency (English "the" is roughly 5–8%);
     * degenerate reasoning climbs past 30–50%. Language-agnostic by
     * construction: it only assumes word boundaries, not English vocabulary.
     * @param {string} text - reasoning (or answer) text to inspect.
     * @returns {number} 0–1, 0 for text too short to judge.
     */
    function repetitionScore(text) {
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

    /**
     * Fold the loaded Chat window into the durable health facts the badge can
     * show: landed compactions, their shadowed tokens, and the latest
     * Assistant's repetition score.
     * @param {readonly object[]|undefined} nodes - Chat legacy Conversation nodes.
     * @param {{blocks: readonly object[]}|null|undefined} partial - live partial Assistant.
     * @returns {object} compaction counts plus the repetition reading.
     */
    function deriveHealth(nodes, partial) {
      const list = Array.isArray(nodes) ? nodes : []
      let compactions = 0
      let shadowedTokens = 0
      let lastCompactionTime = null
      for (const node of list) {
        if (node === null || typeof node !== 'object' || node.kind !== 'compaction') continue
        compactions += 1
        if (typeof node.shadowedTokenCount === 'number') shadowedTokens += node.shadowedTokenCount
        if (typeof node.time === 'number' && (lastCompactionTime === null || node.time > lastCompactionTime)) {
          lastCompactionTime = node.time
        }
      }
      let lastAssistant = null
      for (let index = list.length - 1; index >= 0; index -= 1) {
        if (list[index]?.kind === 'assistant') { lastAssistant = list[index]; break }
      }
      const liveBlocks = Array.isArray(partial?.blocks) && partial.blocks.length > 0 ? partial.blocks : null
      const blocks = liveBlocks ?? (Array.isArray(lastAssistant?.blocks) ? lastAssistant.blocks : [])
      const reasoning = blocks
        .filter(block => block?.kind === 'reasoning' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
      const answer = blocks
        .filter(block => block?.kind === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
      return {
        available: Array.isArray(nodes),
        compactions,
        shadowedTokens,
        lastCompactionTime,
        repetition: repetitionScore(reasoning.length >= 200 ? reasoning : answer),
      }
    }

    /**
     * Human-readable relative age of one timestamp.
     * @param {number} time - Unix epoch ms.
     * @returns {string} compact age.
     */
    function relativeTime(time) {
      const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000))
      if (minutes < 1) return 'just now'
      if (minutes < 60) return minutes + 'm ago'
      const hours = Math.floor(minutes / 60)
      if (hours < 48) return hours + 'h ago'
      return Math.floor(hours / 24) + 'd ago'
    }

    /**
     * Fold the raw percentage and the health facts into one tone.
     * @param {number} percent - context-window occupancy.
     * @param {object} health - deriveHealth result.
     * @returns {'neutral'|'warn'|'danger'} badge tone.
     */
    function healthTone(percent, health) {
      if (percent >= DANGER_PERCENT || health.compactions >= 3 || health.repetition >= REPEAT_DANGER) return 'danger'
      if (percent >= WARN_PERCENT || health.compactions >= 2 || health.repetition >= REPEAT_WARN) return 'warn'
      return 'neutral'
    }

    /**
     * One phrase for the tooltip's health line.
     * @param {object} health - deriveHealth result.
     * @returns {string} English health label.
     */
    function healthLabel(health) {
      const parts = []
      if (health.repetition >= REPEAT_DANGER) parts.push('repetition detected in the latest reasoning')
      else if (health.repetition >= REPEAT_WARN) parts.push('possible repetition in the latest reasoning')
      if (health.compactions >= 3) parts.push(health.compactions + ' compactions')
      else if (health.compactions === 2) parts.push('2 compactions')
      else if (health.compactions === 1) parts.push('1 compaction')
      return parts.length === 0 ? 'healthy' : parts.join(' · ')
    }

    /**
     * One actionable sentence for a non-neutral badge.
     * @param {object} health - merged health facts.
     * @param {number} percent - context-window occupancy.
     * @param {'neutral'|'warn'|'danger'} tone - current tone.
     * @returns {string|null} recommendation, or null when healthy.
     */
    function recommendation(health, percent, tone) {
      if (tone === 'neutral') return null
      if (health.repetition >= REPEAT_DANGER) {
        return 'fork or start a fresh thread; compaction does not reset a repetition loop'
      }
      if (health.compactions >= 3) {
        return 'fork or start a fresh thread; this history has been compacted 3+ times'
      }
      if (percent >= DANGER_PERCENT) return 'start a fresh thread; the context window is nearly full'
      return 'consider a fresh thread for the next large task'
    }

    /**
     * Resolve the display reading from the token meter's non-atomic projection.
     * `projectedTokens` prices the next request (including surface changes since
     * the provider anchor), so it is preferred over the last billed prompt.
     * @param {object|undefined} pressure - latest `contextPressure` value.
     * @returns {{percent: number, usedTokens: number, contextWindow: number}|null}
     *   reading, or null until both a numerator and a positive capacity exist.
     */
    function readOccupancy(pressure) {
      if (pressure === null || pressure === undefined) return null
      const used = pressure.projectedTokens ?? pressure.pressureTokens
      const capacity = pressure.contextWindow
      if (typeof used !== 'number' || !Number.isFinite(used)) return null
      if (typeof capacity !== 'number' || !Number.isFinite(capacity) || capacity <= 0) return null
      const percent = Math.max(0, Math.min(100, Math.round(used / capacity * 100)))
      return { percent, usedTokens: Math.max(0, used), contextWindow: capacity }
    }

    /**
     * Compact token count: 940, 45.2K, 1.28M — trailing zeros trimmed.
     * @param {number} value - token count.
     * @returns {string} display string.
     */
    function formatTokens(value) {
      if (value < 1_000) return String(Math.round(value))
      const scaled = (divisor, digits) => {
        const text = (value / divisor).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
        return text + (divisor === 1_000 ? 'K' : 'M')
      }
      if (value < 1_000_000) return scaled(1_000, value < 10_000 ? 2 : 1)
      return scaled(1_000_000, 2)
    }

    /**
     * Build the rich hover rows: one entry per line, with the prefix separated
     * so it can be bold, and a tone on the lines that carry a warning.
     * @param {object} reading - occupancy result.
     * @param {object} health - merged health facts.
     * @param {string} used - formatted used tokens.
     * @param {string} capacity - formatted capacity.
     * @param {number|null} processed - cumulative billed tokens.
     * @param {number} ratio - processed / capacity.
     * @param {'neutral'|'warn'|'danger'} tone - overall badge tone.
     * @returns {object[]} rows with `label`, `text`, and optional `tone`.
     */
    function tooltipRows(reading, health, used, capacity, processed, ratio, tone) {
      const rows = [{
        key: 'context',
        label: 'Context window:',
        text: '~' + used + ' / ' + capacity + ' tokens (' + reading.percent + '%)',
        tone: reading.percent >= DANGER_PERCENT ? 'danger' : reading.percent >= WARN_PERCENT ? 'warn' : null,
      }]
      if (!health.available) return rows
      const where = health.exact ? '' : ' in the loaded transcript'
      rows.push({
        key: 'compactions',
        label: 'Compactions:',
        text: health.compactions === 0
          ? 'none' + where
          : health.compactions
            + (health.shadowedTokens > 0 ? ' · ~' + formatTokens(health.shadowedTokens) + ' tokens compacted' : '')
            + (health.lastCompactionTime === null ? '' : ' · last ' + relativeTime(health.lastCompactionTime))
            + where,
      })
      const lineTone = health.repetition >= REPEAT_DANGER || health.compactions >= 3
        ? 'danger'
        : health.repetition >= REPEAT_WARN || health.compactions >= 2 ? 'warn' : null
      rows.push({
        key: 'health',
        label: 'Thread health:',
        text: healthLabel(health)
          + (health.repetition > 0 ? ' (max word share ' + Math.round(health.repetition * 100) + '%)' : ''),
        tone: lineTone,
      })
      const advice = recommendation(health, reading.percent, tone)
      if (advice !== null) {
        rows.push({ key: 'recommendation', label: 'Recommendation:', text: advice })
      }
      if (processed !== null && ratio >= 1) {
        rows.push({
          key: 'processed',
          label: 'Processed:',
          text: '~' + formatTokens(processed) + ' tokens (' + Math.round(ratio) + '× window)',
        })
      }
      return rows
    }

    /**
     * One context-window and thread-health reading in the conversation's
     * bottom-right corner. Hover/focus opens a rich portal panel styled like
     * the DSH tooltip: bold line prefixes, 5px extra row spacing, and the
     * warning row tinted with the danger/warn color.
     * @param {object} props - standard session slot props.
     * @returns {object|null} badge element, or null while no capacity is known.
     */
    function ContextBadge(props) {
      const pressure = props.useProjection('contextPressure')
      const usage = props.useProjection('tokenUsage')
      // The fallback keeps the hook order stable if a composition renders this
      // seat without the Chat standard prop; the shipped Web composition has it.
      const readChat = typeof props.useChat === 'function' ? props.useChat : () => undefined
      const legacy = readChat(snapshot => snapshot.legacy)
      const chatHealth = useMemo(
        () => deriveHealth(legacy?.nodes, legacy?.partial),
        [legacy],
      )
      // The host projection folds the complete log, so its compaction count is
      // exact; the Chat fallback only sees the loaded window. Repetition takes
      // the higher reading so a live partial reasoning block can warn before
      // the durable Assistant settles.
      const projected = props.useProjection('contextHealthBadge')
      const health = projected !== null && typeof projected === 'object'
        && typeof projected.compactions === 'number'
        ? {
            available: true,
            exact: true,
            compactions: projected.compactions,
            shadowedTokens: typeof projected.shadowedTokens === 'number' ? projected.shadowedTokens : 0,
            lastCompactionTime: typeof projected.lastCompactionTime === 'number'
              ? projected.lastCompactionTime
              : null,
            repetition: Math.max(
              typeof projected.repetition === 'number' ? projected.repetition : 0,
              chatHealth.repetition,
            ),
          }
        : { ...chatHealth, exact: false }
      const reading = readOccupancy(pressure)
      const [hovered, setHovered] = useState(false)
      const [focused, setFocused] = useState(false)
      const [position, setPosition] = useState(null)
      const rootRef = useRef(null)
      const panelId = useId()
      const open = hovered || focused
      const updatePosition = useCallback(() => {
        const element = rootRef.current
        if (element === null) return
        const rect = element.getBoundingClientRect()
        setPosition({
          right: Math.max(8, window.innerWidth - rect.right),
          bottom: window.innerHeight - rect.top + 8,
        })
      }, [])
      useEffect(() => {
        if (!open) return undefined
        updatePosition()
        const onViewportChange = () => updatePosition()
        window.addEventListener('resize', onViewportChange)
        window.addEventListener('scroll', onViewportChange, true)
        return () => {
          window.removeEventListener('resize', onViewportChange)
          window.removeEventListener('scroll', onViewportChange, true)
        }
      }, [open, updatePosition])
      if (reading === null) return null

      const tone = healthTone(reading.percent, health)
      const used = formatTokens(reading.usedTokens)
      const capacity = formatTokens(reading.contextWindow)
      const processed = usage === undefined || usage === null
        ? null
        : (usage.uncachedInputTokens ?? 0) + (usage.cacheReadTokens ?? 0)
          + (usage.cacheWriteTokens ?? 0) + (usage.outputTokens ?? 0)
      const ratio = processed !== null && processed > 0 ? processed / reading.contextWindow : 0
      const valueText = reading.percent + '% (~' + used + ' of ' + capacity + ' tokens)'
        + (health.available && health.compactions > 0 ? ', ' + health.compactions + ' compactions' : '')
        + (health.repetition >= REPEAT_WARN ? ', repetition warning' : '')
      const rows = tooltipRows(reading, health, used, capacity, processed, ratio, tone)
      const show = () => {
        updatePosition()
        setHovered(true)
      }
      const hide = () => setHovered(false)
      const showFocus = () => {
        updatePosition()
        setFocused(true)
      }
      const hideFocus = () => setFocused(false)
      const panel = open && position !== null && typeof document !== 'undefined'
        ? createPortal(
            React.createElement(
              'div',
              {
                id: panelId,
                role: 'tooltip',
                className: 'dsh-context-health-badge-tooltip',
                style: { right: position.right, bottom: position.bottom },
              },
              rows.map(row => React.createElement(
                'div',
                {
                  key: row.key,
                  className: 'dsh-context-health-badge-tooltip-line',
                  ...(row.tone === null || row.tone === undefined ? {} : { 'data-tone': row.tone }),
                },
                React.createElement('span', { className: 'dsh-context-health-badge-tooltip-label' }, row.label),
                ' ',
                React.createElement('span', null, row.text),
              )),
            ),
            document.body,
          )
        : null

      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'span',
          {
            ref: rootRef,
            className: 'dsh-context-health-badge',
            'data-tone': tone,
            role: 'meter',
            tabIndex: 0,
            'aria-label': 'Context window and thread health',
            'aria-valuenow': reading.percent,
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuetext': valueText,
            'aria-describedby': open ? panelId : undefined,
            onMouseEnter: show,
            onMouseLeave: hide,
            onFocus: showFocus,
            onBlur: hideFocus,
            onKeyDown: (event) => {
              if (event.key === 'Escape') {
                setFocused(false)
                event.currentTarget.blur()
              }
            },
          },
          React.createElement(
            'svg',
            {
              className: 'dsh-context-health-badge-ring',
              viewBox: '0 0 16 16',
              width: 13,
              height: 13,
              'aria-hidden': 'true',
            },
            React.createElement('circle', {
              className: 'dsh-context-health-badge-track',
              cx: 8,
              cy: 8,
              r: RADIUS,
            }),
            React.createElement('circle', {
              className: 'dsh-context-health-badge-fill',
              cx: 8,
              cy: 8,
              r: RADIUS,
              strokeDasharray: (CIRCUMFERENCE * reading.percent / 100) + ' ' + CIRCUMFERENCE,
              transform: 'rotate(-90 8 8)',
            }),
          ),
          React.createElement('span', { className: 'dsh-context-health-badge-label' }, 'ctx'),
          React.createElement('span', { className: 'dsh-context-health-badge-value' }, reading.percent + '%'),
          health.available && health.compactions > 0
            ? React.createElement('span', { className: 'dsh-context-health-badge-meta' }, '· ' + health.compactions + 'C')
            : null,
          health.repetition >= REPEAT_WARN
            ? React.createElement('span', { className: 'dsh-context-health-badge-warning', 'aria-hidden': 'true' }, '⚠')
            : null,
        ),
        panel,
      )
    }

    /** Register the badge when the conversation declares its composer dock. */
    function apply(ctx) {
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'context-health-badge',
        order: 100,
      }, ContextBadge))
    }

    exports.name = 'context-health-badge'
    exports.inject = ['slots']
    exports.apply = apply
    // Exported for the package's own unit test; not part of the UI contract.
    exports.readOccupancy = readOccupancy
    exports.formatTokens = formatTokens
    exports.repetitionScore = repetitionScore
    exports.deriveHealth = deriveHealth
    exports.healthTone = healthTone
    exports.tooltipRows = tooltipRows

    return module.exports
  },
})
