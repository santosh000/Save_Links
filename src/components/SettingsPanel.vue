<script setup>
const props = defineProps({
  appearance: { type: String, required: true },
  colorScheme: { type: String, required: true }
})
const emit = defineEmits(['update:appearance', 'update:colorScheme'])

const appearances = [
  { value: 'light', label: 'Light theme', name: 'Light', icon: 'sun-icon' },
  { value: 'dark', label: 'Dark theme', name: 'Dark', icon: 'moon-icon' },
  { value: 'system', label: 'System theme', name: 'System', icon: 'monitor-icon' }
]
// Color schemes are optional accents; "None" uses the base neutral accent.
// `color` mirrors the scheme accent tokens in src/app-overrides.css so each
// swatch previews its own scheme even while another scheme is active.
const schemes = [
  { value: 'none', label: 'None', color: null },
  { value: 'ocean', label: 'Ocean', color: '#5366C9' },
  { value: 'forest', label: 'Forest', color: '#3F8064' },
  { value: 'lavender', label: 'Lavender', color: '#7969A8' },
  { value: 'amber', label: 'Warm Amber', color: '#B87824' }
]
</script>

<template>
  <section class="settings-card" aria-label="Appearance settings">
    <h4>Appearance</h4>
    <p class="muted">Choose theme and color scheme. System follows OS preference.</p>

    <fieldset class="field">
      <legend>Theme</legend>
      <div class="theme-row" role="radiogroup" aria-label="Appearance">
        <label v-for="opt in appearances" :key="opt.value" class="theme-opt" :class="{ active: appearance === opt.value }">
          <input type="radio" name="appearance" :value="opt.value" :checked="appearance === opt.value" @change="emit('update:appearance', opt.value)" :aria-label="opt.label" />
          <svg class="opt-icon" viewBox="0 0 24 24" aria-hidden="true"><use :href="`/icons.svg#${opt.icon}`" /></svg>
          <span class="opt-name">{{ opt.name }}</span>
        </label>
      </div>
    </fieldset>

    <fieldset class="field">
      <legend>Color Scheme</legend>
      <div class="swatch-row" role="radiogroup" aria-label="Color scheme">
        <label v-for="opt in schemes" :key="opt.value" class="swatch" :class="{ active: colorScheme === opt.value }">
          <input type="radio" name="colorScheme" :value="opt.value" :checked="colorScheme === opt.value" @change="emit('update:colorScheme', opt.value)" :aria-label="opt.label + ' color scheme'" />
          <span class="swatch-dot" :class="{ none: !opt.color }" :style="opt.color ? { background: opt.color } : null" aria-hidden="true">
            <svg v-if="colorScheme === opt.value" class="swatch-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5 9.5 18 20 7" /></svg>
            <svg v-else-if="!opt.color" class="swatch-none" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6" /></svg>
          </span>
          <span class="swatch-name">{{ opt.label }}</span>
        </label>
      </div>
    </fieldset>
  </section>
</template>

<style scoped>
.settings-card {
  background: transparent;
  padding: 0;
}
.settings-card h4 { margin: 0 0 6px; font-size: var(--text-md); font-weight: var(--weight-semibold); color: var(--text-h); }
.muted { color: var(--muted); font-size: var(--text-sm); margin: 0 0 18px; line-height: 1.4; }
.field { border: none; padding: 0; margin: 0 0 18px; }
.field legend { font-size: var(--text-xs); font-weight: var(--weight-semibold); color: var(--muted); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 10px; }

.theme-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.theme-opt {
  position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-2);
  min-width: 0; padding: 14px 10px;
  border: 1px solid var(--border); background: transparent; border-radius: var(--radius-sm);
  color: var(--muted); cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
}
.theme-opt:hover { border-color: var(--accent); background: var(--muted-bg); color: var(--text-h); }
.theme-opt.active { border-color: var(--accent); background: var(--accent-bg); color: var(--accent); }
.theme-opt:has(input:focus-visible) { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 2px; }
.theme-opt input[type="radio"] {
  position: absolute; inset: 0; width: 100%; height: 100%;
  margin: 0; opacity: 0; cursor: pointer;
}
.opt-icon { width: 22px; height: 22px; }
.opt-name { font-size: 12.5px; font-weight: var(--weight-semibold); }

.swatch-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(76px, 1fr)); gap: 10px 6px; }
.swatch {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  min-width: 0; padding: 6px 0; cursor: pointer;
}
.swatch input[type="radio"] {
  position: absolute; inset: 0; width: 100%; height: 100%;
  margin: 0; opacity: 0; cursor: pointer;
}
.swatch:has(input:focus-visible) { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 2px; border-radius: var(--radius-sm); }
.swatch-dot {
  width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
  display: grid; place-items: center;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text-h) 14%, transparent);
}
.swatch-dot.none { background: var(--muted-bg); }
.swatch-dot.none .swatch-check { stroke: var(--text-h); }
.swatch-none { width: 18px; height: 18px; fill: none; stroke: var(--muted); stroke-width: 2; stroke-linecap: round; }
.swatch.active .swatch-dot { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 2px; }
/* White check reads on every scheme swatch, including the mid-tone dark
   accents, so it stays a fixed value rather than following --on-accent. */
.swatch-check { width: 18px; height: 18px; fill: none; stroke: #fff; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.swatch-name { font-size: 11.5px; line-height: 1.3; text-align: center; color: var(--muted); }
.swatch.active .swatch-name { color: var(--accent); font-weight: var(--weight-semibold); }
</style>
