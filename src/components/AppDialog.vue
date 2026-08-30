<script setup>
import { ref, watch, nextTick } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  message: { type: String, default: '' },
  // { label, variant: 'primary' | 'danger' | 'ghost', value, default }
  buttons: { type: Array, default: () => [] }
})
const emit = defineEmits(['choose', 'close'])

const titleId = 'app-dialog-title'
const messageId = 'app-dialog-message'
const panel = ref(null)

// Focus the button marked default (the safe/primary one); fall back to the first.
function focusDefault() {
  nextTick(() => {
    if (!panel.value) return
    const buttons = panel.value.querySelectorAll('button')
    if (!buttons.length) return
    const idx = props.buttons.findIndex(b => b.default)
    buttons[idx === -1 ? 0 : idx].focus()
  })
}

watch(() => props.open, (isOpen) => {
  if (isOpen) focusDefault()
})

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
    return
  }
  if (e.key === 'Tab') {
    // small focus trap: only the dialog's own buttons are focusable
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
    <div v-if="open" class="dialog-backdrop" @click.self="emit('close')">
      <div
        ref="panel"
        class="dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="message ? messageId : undefined"
        @keydown="onKeydown"
      >
        <h3 :id="titleId" class="dialog-title">{{ title }}</h3>
        <p v-if="message" :id="messageId" class="dialog-message">{{ message }}</p>
        <div class="dialog-actions">
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
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(15, 23, 42, 0.5);
  display: grid;
  place-items: center;
  padding: 16px;
}
.dialog {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  width: 100%;
  max-width: 420px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 20px;
}
.dialog-title { margin: 0 0 8px; font-size: 16px; color: var(--text-h); }
.dialog-message { margin: 0 0 16px; font-size: 13px; line-height: 1.5; color: var(--text); overflow-wrap: anywhere; }
.dialog-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.dialog-actions .btn { min-height: 38px; }
.dialog-actions .danger { background: #dc2626; color: #fff; border-color: #dc2626; }
.dialog-actions .danger:hover { background: #b91c1c; border-color: #b91c1c; }
@media (max-width: 480px) {
  .dialog { padding: 16px; }
  .dialog-actions { flex-direction: column; }
  .dialog-actions .btn { width: 100%; }
}
</style>