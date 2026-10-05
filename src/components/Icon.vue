<script setup>
import { computed, watchEffect } from 'vue'
import { ICONS, ICON_SIZES } from './icons.js'

// P15.1 — the one icon component for the whole app: vendored lucide 0.468.0
// geometry (the mockup's icon language), stroke 2, fill none, round caps and
// joins, sizes xs/sm/md/lg = 13/15/18/22, inheriting currentColor.
// Decorative by contract: the interactive parent owns the accessible name.
const props = defineProps({
  name: { type: String, required: true },
  size: { type: String, default: 'md', validator: (v) => v in ICON_SIZES },
})

const nodes = computed(() => ICONS[props.name] || [])
const px = computed(() => ICON_SIZES[props.size] ?? ICON_SIZES.md)

if (import.meta.env.DEV) {
  watchEffect(() => {
    if (!ICONS[props.name]) console.warn(`[Icon] unknown icon name: ${props.name}`)
  })
}
</script>

<template>
  <svg
    class="ic"
    viewBox="0 0 24 24"
    :width="px"
    :height="px"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <component :is="node[0]" v-for="(node, i) in nodes" :key="i" v-bind="node[1]" />
  </svg>
</template>

<style scoped>
.ic {
  display: block;
  flex-shrink: 0;
}
</style>
