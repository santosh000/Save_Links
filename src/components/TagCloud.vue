<script setup>
// P15.12 — the shared tag cloud (mockup .tag-cloud/.tag-pill): real buttons
// bound to the existing filterTag state. Used by the sidebar Tags section and
// by the mobile Tags dialog.
defineProps({
  tags: { type: Array, default: () => [] },
  active: { type: String, default: '' }
})
const emit = defineEmits(['select'])
</script>

<template>
  <div class="tag-cloud" role="group" aria-label="Tag filters">
    <button
      v-for="tag in tags"
      :key="tag"
      type="button"
      class="tag-pill"
      :class="{ active: active === tag }"
      :aria-pressed="String(active === tag)"
      @click="emit('select', tag)"
    >#{{ tag }}</button>
  </div>
</template>
