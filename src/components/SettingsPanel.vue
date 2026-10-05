<script setup>
import Icon from './Icon.vue'

const props = defineProps({
  appearance: { type: String, required: true },
  colorScheme: { type: String, required: true }
})
const emit = defineEmits(['update:appearance', 'update:colorScheme'])

// Registry icon per theme option (the inline SVG recipes are gone; the shared
// registry is the single icon language).
const appearances = [
  { value: 'light', label: 'Light theme', name: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark theme', name: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System theme', name: 'System', icon: 'monitor' }
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
  <!-- P15.10: Settings keeps its view/route but adopts the shared modal-panel
       surface language (centred 560px panel on desktop, full-width sheet-like
       panel on mobile). Every capability and label is unchanged. -->
  <section class="settings-card" aria-label="Settings">
    <div class="settings-body">
      <h4>Appearance</h4>
      <p class="muted">Choose theme and color scheme. System follows OS preference.</p>

      <fieldset class="field">
        <legend>Theme</legend>
        <div class="theme-row" role="radiogroup" aria-label="Appearance">
          <label v-for="opt in appearances" :key="opt.value" class="theme-opt" :class="{ active: appearance === opt.value }">
            <input type="radio" name="appearance" :value="opt.value" :checked="appearance === opt.value" @change="emit('update:appearance', opt.value)" :aria-label="opt.label" />
            <Icon class="opt-icon" :name="opt.icon" size="lg" />
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
              <Icon v-if="colorScheme === opt.value" class="swatch-check" name="check" size="md" />
              <Icon v-else-if="!opt.color" class="swatch-none" name="x" size="md" />
            </span>
            <span class="swatch-name">{{ opt.label }}</span>
          </label>
        </div>
      </fieldset>
    </div>
  </section>
</template>

<style scoped>
/* P15.12: the appearance pane lives inside the Settings modal, so it brings no
   surface of its own — the modal provides the card/radius/shadow. */
.settings-card {
  width: 100%;
  min-width: 0;
}
.settings-body { padding: 0; }
.settings-card h4 { margin: 0 0 var(--space-1); font-size: var(--text-2xl); font-weight: var(--weight-semibold); line-height: 1.2; color: var(--text-h); }
.muted { color: var(--muted); font-size: var(--text-sm); margin: 0 0 40px; line-height: 1.4; }
.field { border: none; padding: 0; margin: 0 0 48px; }
.field:last-child { margin-bottom: 0; }
/* Reference group label: 11px bold, wide tracking, 16px below. */
.field legend { font-size: 11px; font-weight: var(--weight-bold); color: var(--muted); text-transform: uppercase; letter-spacing: .1em; margin-bottom: var(--space-4); }

.theme-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); }
.theme-opt {
  position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-3);
  min-width: 0; padding: 20px;
  border: 1px solid var(--border); background: transparent; border-radius: var(--radius-lg);
  color: var(--muted); cursor: pointer;
  transition: border-color 0.3s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s cubic-bezier(0.4, 0, 0.2, 1), color 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
@media (hover: hover) and (pointer: fine){
.theme-opt:hover { border-color: var(--accent); background: var(--muted-bg); color: var(--text-h); }
}
.theme-opt.active { border-color: var(--accent); background: var(--accent-bg); color: var(--accent); }
.theme-opt:has(input:focus-visible) { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 2px; }
.theme-opt input[type="radio"] {
  position: absolute; inset: 0; width: 100%; height: 100%;
  margin: 0; opacity: 0; cursor: pointer;
}
.opt-icon { stroke-width: 1.8; transition: color 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
.opt-name { font-size: var(--text-sm); font-weight: var(--weight-medium); transition: color 0.3s cubic-bezier(0.4, 0, 0.2, 1); }

/* Reference swatch row: 40px gaps, 48px dots, 12px label gap. */
.swatch-row { display: flex; flex-wrap: wrap; gap: 40px; }
.swatch {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: var(--space-3);
  min-width: 0; cursor: pointer;
}
.swatch input[type="radio"] {
  position: absolute; inset: 0; width: 100%; height: 100%;
  margin: 0; opacity: 0; cursor: pointer;
}
.swatch:has(input:focus-visible) { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 2px; border-radius: var(--radius-sm); }
.swatch-dot {
  width: calc(var(--control-height) + var(--space-2)); height: calc(var(--control-height) + var(--space-2)); border-radius: 50%; flex-shrink: 0;
  display: grid; place-items: center;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text-h) 14%, transparent);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), outline-color 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
@media (hover: hover) and (pointer: fine){
.swatch:hover .swatch-dot { transform: scale(1.1); }
.swatch:hover .swatch-name { color: var(--text-h); }
}
.swatch-dot.none { background: var(--muted-bg); }
/* Selected: the dot carries the reference's enlarged ring/scale treatment. */
.swatch.active .swatch-dot { transform: scale(1.1); outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 4px; }
/* White check reads on every scheme swatch, including the mid-tone dark
   accents, so it stays a fixed value rather than following --on-accent. */
.swatch-check { color: #fff; stroke-width: 2.5; }
.swatch-dot.none .swatch-check { color: var(--text-h); }
.swatch-none { color: var(--muted); }
.swatch-name { font-size: var(--text-xs); line-height: 1.3; text-align: center; color: var(--muted); transition: color 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
.swatch.active .swatch-name { color: var(--accent); font-weight: var(--weight-semibold); }

/* Reduced motion: no hover/selected scaling. */
@media (prefers-reduced-motion: reduce) {
  .swatch:hover .swatch-dot, .swatch.active .swatch-dot { transform: none; }
}
</style>
