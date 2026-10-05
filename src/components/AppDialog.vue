<script setup>
// P15.8 — the single reusable modal shell, rebuilt to the mockup's modal
// language (.addlink): bottom sheet <768, centred panel >=768, head with the
// title + close X, scrollable body, footer with equal-width actions.
// Consumers keep providing their real title/message/buttons; behavior
// (Escape, backdrop close, focus in/trap/restore, teleport, aria) is unchanged.
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  message: { type: String, default: '' },
  // { label, variant: 'primary' | 'danger' | 'ghost', value, default }
  buttons: { type: Array, default: () => [] },
  // 'wide' is the settings-style panel (left section nav + content pane).
  size: { type: String, default: 'default' }, // 'default' | 'wide'
  // Optional selector inside the panel to focus on open (the Add-link form's
  // URL field). Callers that omit it keep the default-button/close focus.
  initialFocus: { type: String, default: '' }
})
const emit = defineEmits(['choose', 'close'])

const titleId = 'app-dialog-title'
const messageId = 'app-dialog-message'
const panel = ref(null)

// Focus the button marked default (the safe/primary one); fall back to the
// first ACTION button — the close X is a separate control, never the default.
// Panels without action buttons (settings/about) focus their close control.
function focusDefault() {
  nextTick(() => {
    if (!panel.value) return
    if (props.initialFocus) {
      const target = panel.value.querySelector(props.initialFocus)
      if (target) {
        target.focus()
        return
      }
    }
    const buttons = panel.value.querySelectorAll('.dialog-actions button')
    if (!buttons.length) {
      panel.value.querySelector('.dialog-close')?.focus()
      return
    }
    const idx = props.buttons.findIndex(b => b.default)
    buttons[idx === -1 ? 0 : idx].focus()
  })
}

// Escape must close the dialog whenever it is open, even if focus left the
// panel (e.g. a control was disabled while focused). The focused-panel path
// still handles and stops the event first; this is the fallback.
function onDocumentKeydown(e) {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  emit('close')
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('keydown', onDocumentKeydown)
    focusDefault()
  } else {
    document.removeEventListener('keydown', onDocumentKeydown)
  }
})
onBeforeUnmount(() => document.removeEventListener('keydown', onDocumentKeydown))

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
    return
  }
  if (e.key === 'Tab') {
    // small focus trap: only the dialog's own controls are focusable
    const buttons = panel.value ? panel.value.querySelectorAll('button') : []
    if (!buttons.length) return
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    const active = document.activeElement
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="dialog-backdrop" @click.self="emit('close')">
        <div
          ref="panel"
          class="dialog"
          :class="{ 'dialog--wide': size === 'wide' }"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          :aria-describedby="message ? messageId : undefined"
          @keydown="onKeydown"
        >
          <div class="dialog-head">
            <h3 :id="titleId" class="dialog-title">{{ title }}</h3>
            <button type="button" class="dialog-close" aria-label="Close dialog" @click="emit('close')">
              <Icon name="x" size="sm" />
            </button>
          </div>
          <div v-if="message || $slots.default" :id="messageId" class="dialog-message" :class="{ 'dialog-message--flush': size === 'wide' }">
            <slot>{{ message }}</slot>
          </div>
          <div v-if="buttons.length" class="dialog-actions">
            <button
              v-for="b in buttons"
              :key="b.value"
              type="button"
              class="btn"
              :class="{ primary: b.variant === 'primary', danger: b.variant === 'danger', ghost: b.variant === 'ghost' }"
              @click="emit('choose', b.value)"
            >{{ b.label }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Overlay: mockup .addlink — bottom sheet below 768, centred above it. */
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--overlay);
  backdrop-filter: blur(var(--overlay-blur));
  -webkit-backdrop-filter: blur(var(--overlay-blur));
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: var(--safe-area-bottom);
}

/* Panel: mockup .addlink-panel — full width, max 560px, radius 16, shadow-lg. */
.dialog {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 560px;
  max-height: 92dvh;
  background: var(--card);
  border: 1px solid var(--border);
  border-bottom: none;
  border-top-left-radius: var(--radius-lg);
  border-top-right-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

/* Head: mockup .addlink-head (icon slot is the close X). */
.dialog-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.dialog-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--text-md);
  font-weight: var(--weight-semibold);
  color: var(--text-h);
  overflow-wrap: anywhere;
}
.dialog-close {
  flex-shrink: 0;
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast), transform var(--transition-fast);
}
@media (hover: hover) and (pointer: fine) {
  .dialog-close:hover { background: var(--muted-bg); color: var(--text-h); }
}
.dialog-close:active { transform: scale(0.92); }
.dialog-close:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 1px; }

/* Body: mockup .addlink-body — the scrollable content region. */
.dialog-message {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  margin: 0;
  padding: 16px;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--text);
  overflow-wrap: anywhere;
}
/* The wide Settings shell owns its own layout: the section nav is flush with
   the modal edges and the pane provides the padding/scrolling. */
.dialog-message--flush { padding: 0; }

/* Footer: mockup .addlink-foot — equal actions; wraps instead of crushing on
   very narrow widths (the mockup itself only shows two). */
.dialog-actions {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: var(--card);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.dialog-actions .btn {
  flex: 1 1 140px;
  min-height: 46px;
}
/* Button sizing, variants and states come from the shared control language
   (src/app-overrides.css) — the dialog only lays its actions out. */

/* >=768: centred panel (mockup .addlink at the same breakpoint). */
@media (min-width: 768px) {
  .dialog-backdrop {
    align-items: center;
    padding: 16px;
    padding-bottom: calc(16px + var(--safe-area-bottom));
  }
  .dialog {
    border-bottom: 1px solid var(--border);
    border-radius: var(--radius-lg);
    max-height: 88dvh;
  }
}
/* 'wide': the Settings shell matches the reference modal geometry — 900px wide,
   650px tall, 24px radius — while keeping the fixed-shell contract (short
   viewports cap the height instead of overflowing). */
.dialog--wide { max-width: 900px; height: 92dvh; border-radius: 24px 24px 0 0; }
@media (min-width: 768px) {
  .dialog--wide {
    height: 650px;
    max-height: calc(100dvh - 32px - var(--safe-area-bottom));
    border-radius: 24px;
  }
  /* The reference page frames the modal with 32px page padding. */
  .dialog-backdrop:has(.dialog--wide) {
    padding: 32px;
    padding-bottom: calc(32px + var(--safe-area-bottom));
  }
}
</style>
