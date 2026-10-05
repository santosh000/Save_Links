<script setup>
import { ref, computed, watch, nextTick } from 'vue'

// Command palette — a separate keyboard layer over real SaveLink actions.
// It does NOT reimplement search: the "Search links" command delegates to the
// existing navbar search. App.vue owns the command list and executes actions;
// this component only filters, highlights, and emits.
const props = defineProps({
  open: { type: Boolean, default: false },
  commands: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'execute'])

const query = ref('')
const activeIndex = ref(0)
const inputEl = ref(null)
let restoreEl = null

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.commands
  return props.commands.filter((c) => {
    const hay = `${c.label} ${c.group || ''} ${c.keywords || ''}`.toLowerCase()
    return hay.includes(q)
  })
})

watch(() => props.open, async (isOpen) => {
  if (isOpen) {
    restoreEl = document.activeElement
    query.value = ''
    activeIndex.value = 0
    await nextTick()
    inputEl.value?.focus()
  } else {
    // Restore focus synchronously (the trigger still exists at this point).
    // A command executed from the palette runs AFTER this and may deliberately
    // move focus (search field / Add form), which then wins.
    const el = restoreEl
    restoreEl = null
    if (el && document.body.contains(el)) el.focus()
  }
})

watch(filtered, () => { activeIndex.value = 0 })

function move(delta) {
  const n = filtered.value.length
  if (!n) return
  activeIndex.value = (activeIndex.value + delta + n) % n
}

function choose(index = activeIndex.value) {
  const cmd = filtered.value[index]
  if (!cmd) return
  emit('execute', cmd.id)
}

function onKeydown(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
  else if (e.key === 'Enter') { e.preventDefault(); choose() }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); emit('close') }
}

function activeId() {
  const cmd = filtered.value[activeIndex.value]
  return cmd ? 'command-' + cmd.id : undefined
}
</script>

<template>
  <Teleport to="body">
    <Transition name="cmd-fade">
      <div v-if="open" class="command-overlay" @click.self="emit('close')">
        <div class="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
          <input
            ref="inputEl"
            v-model="query"
            type="text"
            class="command-input"
            placeholder="Type a command…"
            aria-label="Search commands"
            aria-keyshortcuts="Control+K Meta+K"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-autocomplete="list"
            :aria-activedescendant="activeId()"
            @keydown="onKeydown"
          />
          <ul v-if="filtered.length" id="command-list" class="command-list" role="listbox" aria-label="Commands">
            <li v-for="(c, i) in filtered" :key="c.id" role="presentation">
              <button
                :id="'command-' + c.id"
                type="button"
                role="option"
                :aria-selected="String(i === activeIndex)"
                class="command-item"
                :class="{ active: i === activeIndex }"
                @click="choose(i)"
                @mousemove="activeIndex = i"
              >
                <span class="command-label">{{ c.label }}</span>
                <span v-if="c.group" class="command-group">{{ c.group }}</span>
              </button>
            </li>
          </ul>
          <p v-else class="command-empty">No matching commands</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.command-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal, 1050);
  background: var(--overlay);
  backdrop-filter: blur(var(--overlay-blur));
  -webkit-backdrop-filter: blur(var(--overlay-blur));
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 12vh var(--space-3) var(--space-3);
}
.command-palette {
  width: 100%;
  max-width: 540px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);    /* shared modal-surface radius */
  box-shadow: var(--shadow-lg);     /* mockup: floating palette uses lg */
  overflow: hidden;
}
.command-input {
  width: 100%;
  padding: 15px 16px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text-h);
  font-size: 15px;
  font-family: inherit;
  outline: none;
}
.command-input::placeholder { color: var(--text-subtle); }
.command-list { list-style: none; margin: 0; padding: 6px; overflow-y: auto; overscroll-behavior: contain; }
.command-item {
  width: 100%;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: 11px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-h);
  font-size: 13.5px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.command-item.active { background: var(--accent-bg); color: var(--accent); }
.command-label { flex: 1 1 auto; min-width: 0; }
.command-group { flex-shrink: 0; font-size: var(--text-xs); color: var(--muted); }
.command-item.active .command-group { color: var(--accent); }
.command-empty { margin: 0; padding: 16px; font-size: var(--text-sm); color: var(--muted); }

.cmd-fade-enter-active,
.cmd-fade-leave-active { transition: opacity .15s ease; }
.cmd-fade-enter-from,
.cmd-fade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .cmd-fade-enter-active,
  .cmd-fade-leave-active { transition: none; }
}
</style>
