import { watch, nextTick, onBeforeUnmount } from 'vue'

// Anchored popover positioning shared by the "Save a Link" and card-edit forms.
//
// The popover must be a `position: fixed` element that the caller renders
// (typically via <Teleport to="body">). This helper keeps it attached to its
// trigger without hardcoding top/bottom:
//   - measures trigger + popover rects,
//   - opens downward when there is room below, otherwise flips upward,
//   - clamps to the viewport so it never leaves the screen horizontally,
//   - re-runs on scroll/resize and whenever the popover grows or shrinks
//     (ResizeObserver) so "More options" growth is handled automatically.
//
// It also closes on an outside pointerdown, while ignoring clicks inside the
// popover or on the trigger (the trigger keeps its own toggle behaviour).
//
// `mode` selects the presentation (one positioning system, two modes):
//   'anchor' (default) – attached to the trigger: opens below, flips above when
//                        there is no room, clamped to the viewport.
//   'auto'             – 'anchor' above the mobile breakpoint, 'center' below it
//                        (the mobile presentation for the Add / Edit forms).
//   'center'           – centred in the viewport with equal margins, so a tall
//                        form never hugs an edge. The trigger keeps its position
//                        and still owns opening/closing.
const MOBILE_MAX_WIDTH = 768 // mirrors the mobile shell breakpoint (app-overrides.css)

function isMobileViewport() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches
    : false
}

// Height reserved at the bottom of the screen by the mobile shell's fixed
// navigation bar. Read from the existing design-system tokens (bar height +
// safe-area inset) so no dimension is duplicated here; 0 when unavailable
// (e.g. jsdom, or a page without the shell).
function bottomReservedSpace() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 0
  const styles = getComputedStyle(document.documentElement)
  const px = (name) => {
    const value = parseFloat(styles.getPropertyValue(name))
    return Number.isFinite(value) ? value : 0
  }
  return px('--bottom-nav-height') + px('--safe-area-bottom')
}

export function useAnchoredPopover({ trigger, popover, isOpen, onOutside, gap = 8, padding = 8, mode = 'anchor', ignoreSelector = null }) {
  let frame = 0
  let observer = null

  function usesCenteredMode() {
    return mode === 'center' || (mode === 'auto' && isMobileViewport())
  }

  function place() {
    const t = trigger.value
    const p = popover.value
    if (!t || !p) return
    const tr = t.getBoundingClientRect()
    const pr = p.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.visualViewport?.height ?? window.innerHeight

    if (usesCenteredMode()) {
      // Centre inside the usable band only: the fixed bottom navigation is not
      // available to the popover, so an expanded form never covers the bar.
      const band = Math.max(pr.height, vh - bottomReservedSpace())
      p.style.top = `${Math.round(Math.max(padding, (band - pr.height) / 2))}px`
      p.style.left = `${Math.round(Math.max(padding, (vw - pr.width) / 2))}px`
      return
    }

    // Prefer below the trigger; flip above only when below does not fit and
    // there is more room above.
    const spaceBelow = vh - tr.bottom - gap - padding
    const spaceAbove = tr.top - gap - padding
    const openUp = pr.height > spaceBelow && spaceAbove > spaceBelow

    let top = openUp ? tr.top - gap - pr.height : tr.bottom + gap
    top = Math.max(padding, Math.min(top, vh - pr.height - padding))

    // Horizontal: attach to the trigger's side of the viewport. A trigger on
    // the left half aligns its left edge with the popover; a trigger on the
    // right half aligns its right edge. Clamp so it never leaves the screen.
    const anchorLeft = tr.left + tr.width / 2 > vw / 2
      ? tr.right - pr.width // right-edge alignment
      : tr.left             // left-edge alignment
    const left = Math.max(padding, Math.min(anchorLeft, vw - pr.width - padding))

    p.style.top = `${Math.round(top)}px`
    p.style.left = `${Math.round(left)}px`
  }

  function schedule() {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      place()
    })
  }

  function onDocPointerDown(e) {
    const target = e.target
    if (trigger.value?.contains(target) || popover.value?.contains(target)) return
    // A nested control may render its own teleported surface outside this
    // popover (e.g. an AppSelect menu inside an item quick-action menu): a
    // pointerdown there belongs to this popover, not outside it.
    if (ignoreSelector && target instanceof Element && target.closest(ignoreSelector)) return
    onOutside?.()
  }

  function teardown() {
    window.removeEventListener('resize', schedule)
    window.removeEventListener('scroll', schedule, true)
    document.removeEventListener('pointerdown', onDocPointerDown, true)
    observer?.disconnect()
    observer = null
    if (frame) {
      cancelAnimationFrame(frame)
      frame = 0
    }
  }

  watch(isOpen, async (open) => {
    teardown()
    if (!open) return
    // Render (with the enter-from opacity still hiding it), then position
    // before the transition's next frame makes it visible.
    await nextTick()
    place()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    document.addEventListener('pointerdown', onDocPointerDown, true)
    if (typeof ResizeObserver !== 'undefined' && popover.value) {
      observer = new ResizeObserver(schedule)
      observer.observe(popover.value)
    }
  })

  // Re-anchor when the caller swaps the trigger while the popover is open
  // (e.g. the Save a Link popover moving from the toolbar to the header button).
  watch(trigger, async () => {
    if (!isOpen.value) return
    await nextTick()
    place()
  })

  onBeforeUnmount(teardown)
}
