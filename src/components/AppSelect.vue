<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useAnchoredPopover } from '../utils/anchoredPopover.js'

// One shared dropdown for the whole app.
//
// Why not a native <select>: the option popup is drawn by the OS/browser, so
// its blue highlight cannot be restyled — it ignores the design system. This
// component renders a real listbox we fully control (neutral surfaces, no
// scheme-tinted rows) while keeping a visually hidden native <select> as the
// value carrier, so form semantics, `for=`/label wiring and existing
// automation that drives `#id` keep working unchanged.
//
// Variants match the contexts the app already had:
//   field  — form field on an inset surface (Add/Edit link forms)
//   header — quiet toolbar control (sort / filter selects)
//   inline — tiny control inside a card or list row
const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  id: { type: String, default: undefined },
  ariaLabel: { type: String, default: undefined },
  variant: { type: String, default: 'field' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'change'])

// Accept the three option shapes already used across the app: plain strings
// (categories), { value, label } (sort/status) and { id, name } (folders).
const normalized = computed(() =>
  props.options.map((o) => {
    if (o === null || o === undefined) return { value: '', label: '' }
    if (typeof o === 'string' || typeof o === 'number') return { value: o, label: String(o) }
    if (o.value !== undefined) return { value: o.value, label: o.label ?? String(o.value) }
    return { value: o.id, label: o.name }
  })
)

const selectedIndex = computed(() =>
  normalized.value.findIndex((o) => String(o.value) === String(props.modelValue ?? ''))
)
const selectedLabel = computed(() => normalized.value[selectedIndex.value]?.label ?? '')

const triggerEl = ref(null)
const menuEl = ref(null)
const open = ref(false)
const activeIndex = ref(0)
const listId = computed(() => `${props.id || 'asel'}-listbox`)

useAnchoredPopover({
  trigger: triggerEl,
  popover: menuEl,
  isOpen: open,
  onOutside: () => close(),
})

function optionId(i) {
  return `${listId.value}-opt-${i}`
}

async function openMenu(startAt) {
  if (props.disabled || open.value) return
  activeIndex.value = startAt ?? (selectedIndex.value >= 0 ? selectedIndex.value : 0)
  open.value = true
  await nextTick()
  scrollActiveIntoView()
}

function close() {
  open.value = false
}

function pick(option) {
  close()
  triggerEl.value?.focus()
  if (String(option.value) === String(props.modelValue ?? '')) return
  emit('update:modelValue', option.value)
  emit('change', option.value)
}

function onTriggerClick() {
  if (open.value) close()
  else openMenu()
}

function move(delta) {
  if (!open.value) return openMenu(delta > 0 ? (selectedIndex.value >= 0 ? selectedIndex.value : 0) : normalized.value.length - 1)
  const count = normalized.value.length
  if (!count) return
  activeIndex.value = (activeIndex.value + delta + count) % count
  scrollActiveIntoView()
}

function scrollActiveIntoView() {
  const el = menuEl.value?.querySelector('.asel-option.is-active')
  el?.scrollIntoView({ block: 'nearest' })
}

function onTriggerKeydown(e) {
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); move(1); break
    case 'ArrowUp': e.preventDefault(); move(-1); break
    case 'Home': if (open.value) { e.preventDefault(); activeIndex.value = 0; scrollActiveIntoView() } break
    case 'End': if (open.value) { e.preventDefault(); activeIndex.value = normalized.value.length - 1; scrollActiveIntoView() } break
    case 'Enter': case ' ': e.preventDefault(); if (open.value) pick(normalized.value[activeIndex.value]); else openMenu(); break
    case 'Escape': if (open.value) { e.preventDefault(); close() } break
    case 'Tab': close(); break
    default: break
  }
}

// Automation (and any legacy code) can still drive the hidden native select.
function onNativeChange(e) {
  const value = e.target.value
  if (String(value) === String(props.modelValue ?? '')) return
  emit('update:modelValue', value)
  emit('change', value)
}

watch(() => props.modelValue, () => { if (!open.value) activeIndex.value = Math.max(selectedIndex.value, 0) })
</script>

<template>
  <div class="asel" :class="`asel--${variant}`">
    <!-- Value carrier: keeps native select semantics for labels and tests.
         Not focusable/clickable, so the visible listbox is the real control. -->
    <select
      :id="id"
      class="asel-native"
      :value="modelValue"
      :disabled="disabled"
      aria-hidden="true"
      tabindex="-1"
      @change="onNativeChange"
    >
      <option v-for="(o, i) in normalized" :key="`${o.value}-${i}`" :value="o.value">{{ o.label }}</option>
    </select>

    <button
      ref="triggerEl"
      type="button"
      class="asel-trigger"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-label="ariaLabel"
      :aria-activedescendant="open ? optionId(activeIndex) : undefined"
      :disabled="disabled"
      @click="onTriggerClick"
      @keydown="onTriggerKeydown"
    >
      <span class="asel-value">{{ selectedLabel }}</span>
      <svg class="asel-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>

    <Teleport to="body">
      <Transition name="fade-down">
        <ul
          v-if="open"
          :id="listId"
          ref="menuEl"
          class="asel-menu"
          role="listbox"
          :aria-label="ariaLabel"
        >
          <li
            v-for="(o, i) in normalized"
            :id="optionId(i)"
            :key="`${o.value}-${i}`"
            class="asel-option"
            :class="{ 'is-active': i === activeIndex }"
            role="option"
            :aria-selected="String(o.value) === String(modelValue ?? '')"
            @click="pick(o)"
            @mousemove="activeIndex = i"
          >
            <span class="asel-option-label">{{ o.label }}</span>
            <svg v-if="String(o.value) === String(modelValue ?? '')" class="asel-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </li>
        </ul>
      </Transition>
    </Teleport>
  </div>
</template>
