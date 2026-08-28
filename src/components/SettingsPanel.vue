<script setup>
const props = defineProps({
  appearance: { type: String, required: true },
  colorScheme: { type: String, required: true }
})
const emit = defineEmits(['update:appearance', 'update:colorScheme'])

const appearances = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]
const schemes = [
  { value: 'ocean', label: 'Ocean Blue' },
  { value: 'forest', label: 'Forest Green' },
  { value: 'lavender', label: 'Lavender' },
  { value: 'amber', label: 'Warm Amber' }
]
</script>

<template>
  <section class="settings-card" aria-label="Appearance settings">
    <h4>Appearance</h4>
    <p class="muted">Choose theme and color scheme. System follows OS preference.</p>

    <fieldset class="field">
      <legend>Theme</legend>
      <div class="options" role="radiogroup" aria-label="Appearance">
        <label v-for="opt in appearances" :key="opt.value" class="radio">
          <input type="radio" name="appearance" :value="opt.value" :checked="appearance===opt.value" @change="emit('update:appearance', opt.value)" :aria-label="opt.label" />
          {{ opt.label }}
        </label>
      </div>
    </fieldset>

    <fieldset class="field">
      <legend>Color Scheme</legend>
      <div class="options" role="radiogroup" aria-label="Color scheme">
        <label v-for="opt in schemes" :key="opt.value" class="radio">
          <input type="radio" name="colorScheme" :value="opt.value" :checked="colorScheme===opt.value" @change="emit('update:colorScheme', opt.value)" :aria-label="opt.label" />
          {{ opt.label }}
        </label>
      </div>
    </fieldset>
  </section>
</template>

<style scoped>
.settings-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px;
}
.settings-card h4 { margin:0 0 6px; font-size:13px; color:var(--text-h); }
.muted { color: var(--muted); font-size:13px; margin:0 0 12px; line-height:1.4; }
.field { border:none; padding:0; margin:0 0 12px; }
.field legend { font-size:12px; font-weight:700; color:var(--text-h); margin-bottom:8px; }
.options { display:flex; gap:8px; flex-wrap:wrap; }
.radio {
  display:flex; gap:6px; align-items:center;
  padding:6px 10px;
  border:1px solid var(--border);
  background: var(--bg);
  border-radius:999px;
  font-size:13px;
  color:var(--text-h);
  cursor:pointer;
}
.radio:has(input:checked) { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.radio input { accent-color: var(--accent); }
</style>
