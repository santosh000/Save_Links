<script setup>
const props = defineProps({
  appearance: { type: String, required: true },
  colorScheme: { type: String, required: true }
})
const emit = defineEmits(['update:appearance', 'update:colorScheme'])

const appearances = [
  { value: 'light', label: 'Light theme', icon: 'sun-icon' },
  { value: 'dark', label: 'Dark theme', icon: 'moon-icon' },
  { value: 'system', label: 'System theme', icon: 'monitor-icon' }
]
// swatch colors mirror the light-mode accent tokens in src/style.css
const schemes = [
  { value: 'ocean', label: 'Ocean', color: '#4f46e5' },
  { value: 'forest', label: 'Forest', color: '#2d6a4f' },
  { value: 'lavender', label: 'Lavender', color: '#7c6da6' },
  { value: 'amber', label: 'Amber', color: '#b45309' }
]
</script>

<template>
  <section class="settings-card" aria-label="Appearance settings">
    <h4>Appearance</h4>
    <p class="muted">Choose theme and color scheme. System follows OS preference.</p>

    <fieldset class="field">
      <legend>Theme</legend>
      <div class="theme-row" role="radiogroup" aria-label="Appearance">
        <label v-for="opt in appearances" :key="opt.value" class="theme-opt" :class="{ active: appearance === opt.value }" :title="opt.label">
          <input type="radio" name="appearance" :value="opt.value" :checked="appearance === opt.value" @change="emit('update:appearance', opt.value)" :aria-label="opt.label" />
          <svg class="opt-icon" aria-hidden="true"><use :href="`/icons.svg#${opt.icon}`" /></svg>
        </label>
      </div>
    </fieldset>

    <fieldset class="field">
      <legend>Color Scheme</legend>
      <div class="swatch-row" role="radiogroup" aria-label="Color scheme">
        <label v-for="opt in schemes" :key="opt.value" class="swatch" :class="{ active: colorScheme === opt.value }" :title="opt.label + ' color scheme'">
          <input type="radio" name="colorScheme" :value="opt.value" :checked="colorScheme === opt.value" @change="emit('update:colorScheme', opt.value)" :aria-label="opt.label + ' color scheme'" />
          <span class="swatch-dot" :style="{ background: opt.color }" aria-hidden="true">
            <svg v-if="colorScheme === opt.value" class="swatch-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5 9.5 18 20 7" /></svg>
          </span>
          <span class="swatch-name">{{ opt.label }}</span>
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
.settings-card h4 { margin: 0 0 6px; font-size: 13px; color: var(--text-h); }
.muted { color: var(--muted); font-size: 13px; margin: 0 0 14px; line-height: 1.4; }
.field { border: none; padding: 0; margin: 0 0 14px; }
.field legend { font-size: 12px; font-weight: 700; color: var(--text-h); margin-bottom: 10px; }

.theme-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.theme-opt {
  position: relative;
  display: flex; align-items: center; justify-content: center;
  min-width: 0; height: 38px; padding: 0;
  border: 1px solid var(--border); background: var(--bg); border-radius: 10px;
  color: var(--text-h); cursor: pointer;
}
.theme-opt:hover { border-color: var(--accent-border); }
.theme-opt.active { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.theme-opt:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.theme-opt input[type="radio"] {
  position: absolute; inset: 0; width: 100%; height: 100%;
  margin: 0; opacity: 0; cursor: pointer;
}
.opt-icon { width: 16px; height: 16px; }

.swatch-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px 6px; }
.swatch {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  min-width: 0; padding: 4px 0; cursor: pointer;
}
.swatch input[type="radio"] {
  position: absolute; inset: 0; width: 100%; height: 100%;
  margin: 0; opacity: 0; cursor: pointer;
}
.swatch:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 10px; }
.swatch-dot {
  width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
  display: grid; place-items: center;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.14);
}
.swatch.active .swatch-dot { outline: 2px solid var(--accent); outline-offset: 2px; }
.swatch-check { width: 18px; height: 18px; fill: none; stroke: #fff; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.swatch-name { font-size: 11px; line-height: 1.3; text-align: center; color: var(--muted); }
.swatch.active .swatch-name { color: var(--accent); font-weight: 700; }
</style>
