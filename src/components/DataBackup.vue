<script setup>
import { ref, computed, onMounted } from 'vue'
import Icon from './Icon.vue'
import {
  createBackupPayload,
  prepareImport,
  downloadBackupFile,
  getLastBackupAt,
} from '../utils/backup.js'

const props = defineProps({
  links: { type: Array, required: true },
  profile: { type: Object, required: true },
  folders: { type: Array, default: () => [] },
  appearance: { type: String, default: 'system' },
  colorScheme: { type: String, default: 'none' },
})

const emit = defineEmits(['import-request', 'show-toast'])

const fileInput = ref(null)
const lastBackupAt = ref(null)
const error = ref('')

// Import preview state
const importPreview = ref(null)
const pendingImport = ref(null)
const importStrategy = ref('skip') // 'skip' | 'replace'

// Computed: human-readable duplicate summary
const duplicateSummary = computed(() => {
  if (!importPreview.value) return ''
  const { counts } = importPreview.value
  const linkDups = counts.links.duplicate
  const folderDups = counts.folders.duplicate
  if (linkDups === 0 && folderDups === 0) return ''
  const parts = []
  if (linkDups > 0) parts.push(`${linkDups} link${linkDups !== 1 ? 's' : ''}`)
  if (folderDups > 0) parts.push(`${folderDups} folder${folderDups !== 1 ? 's' : ''}`)
  return `${parts.join(' and ')} already exist${linkDups + folderDups > 1 ? '' : 's'} on your device.`
})

// Computed: whether there are any conflicts at all
const hasConflicts = computed(() => {
  if (!importPreview.value) return false
  return importPreview.value.counts.links.duplicate > 0 || importPreview.value.counts.folders.duplicate > 0
})

// Computed: total links/folders in backup
const backupTotals = computed(() => {
  if (!importPreview.value) return { links: 0, folders: 0 }
  const { counts } = importPreview.value
  return {
    links: counts.links.total,
    folders: counts.folders.total
  }
})

const formattedLastBackup = computed(() => {
  if (!lastBackupAt.value) return ''
  try {
    return new Date(lastBackupAt.value).toLocaleString()
  } catch {
    return lastBackupAt.value
  }
})

onMounted(() => {
  lastBackupAt.value = getLastBackupAt()
})

function triggerExport() {
  error.value = ''
  try {
    downloadBackupFile({ links: props.links, profile: props.profile, folders: props.folders, appearance: props.appearance, colorScheme: props.colorScheme })
    lastBackupAt.value = getLastBackupAt()
    emit('show-toast', 'Backup exported')
  } catch (e) {
    error.value = e?.message || 'Export failed'
    emit('show-toast', error.value)
  }
}

// Test-only method to get backup payload as JSON (for E2E testing)
function getBackupPayloadJson() {
  const payload = createBackupPayload({ links: props.links, profile: props.profile, folders: props.folders, appearance: props.appearance, colorScheme: props.colorScheme })
  return JSON.stringify(payload, null, 2)
}

// Expose test-only method on window for E2E tests
if (typeof window !== 'undefined' && (window.__TEST__ || process.env.NODE_ENV === 'test')) {
  window.__getBackupPayloadJson = getBackupPayloadJson
}

function triggerImport() {
  error.value = ''
  fileInput.value?.click()
}

async function handleImport(event) {
  const file = event.target.files?.[0]
  // reset input so same file can be selected again
  event.target.value = ''
  if (!file) return

  let text = ''
  try {
    text = await file.text()
  } catch {
    error.value = 'Invalid backup file: not valid JSON'
    emit('show-toast', error.value)
    return
  }

  const result = prepareImport(text, { links: props.links, folders: props.folders })
  if (result.error) {
    error.value = result.error
    emit('show-toast', result.error)
    return
  }

  const { data, preview } = result

  // If no duplicates, proceed directly with skip strategy (additive import)
  if (preview.counts.links.duplicate === 0 && preview.counts.folders.duplicate === 0) {
    pendingImport.value = { data, strategy: 'skip' }
    importPreview.value = null
    emit('import-request', { data, strategy: 'skip' })
    return
  }

  // Duplicates found - show preview modal
  pendingImport.value = { data }
  importPreview.value = preview
}

function confirmSkip() {
  if (!pendingImport.value) return
  emit('import-request', { data: pendingImport.value.data, strategy: 'skip' })
  importPreview.value = null
  pendingImport.value = null
}

function confirmReplace() {
  if (!pendingImport.value) return
  emit('import-request', { data: pendingImport.value.data, strategy: 'replace' })
  importPreview.value = null
  pendingImport.value = null
}

function cancelPreview() {
  importPreview.value = null
  pendingImport.value = null
}

function handleImportClick() {
  if (hasConflicts.value) {
    if (importStrategy.value === 'replace') {
      confirmReplace()
    } else {
      confirmSkip()
    }
    return
  }
  confirmSkip()
}
</script>

<template>
  <section class="backup-card">
    <h4>Data & Backup</h4>
    <p class="muted">Protect your saved links.</p>
    <div class="actions">
      <button class="btn secondary" @click="triggerExport">
        <Icon name="download" size="md" />
        <span>Export Backup</span>
      </button>
      <button class="btn secondary" @click="triggerImport">
        <Icon name="upload" size="md" />
        <span>Import Backup</span>
      </button>
      <input ref="fileInput" type="file" accept=".json,application/json" style="display:none" @change="handleImport" />
    </div>
    <p v-if="lastBackupAt" class="backup-status">
      <span class="status-dot" aria-hidden="true"><span class="status-dot-ping"></span></span>
      <span>Last backup: {{ formattedLastBackup }}</span>
    </p>
    <p v-if="error" class="error small">{{ error }}</p>
  </section>

  <!-- Import Preview Modal -->
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="importPreview" class="import-preview-backdrop" @click.self="cancelPreview">
      <div class="import-preview-modal" role="dialog" aria-modal="true" aria-labelledby="import-preview-title" @keydown.esc="cancelPreview">
        <h3 id="import-preview-title">Import Backup</h3>
        <p class="import-preview-summary">
          This backup has {{ backupTotals.links }} link{{ backupTotals.links !== 1 ? 's' : '' }} and {{ backupTotals.folders }} folder{{ backupTotals.folders !== 1 ? 's' : '' }}.
        </p>

        <p v-if="hasConflicts" class="import-preview-duplicates">
          {{ duplicateSummary }}
        </p>

        <p v-else class="import-preview-no-conflicts">
          These items are new to your device.
        </p>

        <p v-if="hasConflicts" class="import-preview-choice">How would you like to handle them?</p>

        <div v-if="hasConflicts" class="import-preview-radio">
          <label>
            <input type="radio" name="import-strategy" value="skip" checked @change="$event.target.checked && (importStrategy = 'skip')" />
            <div class="radio-option">
              <span class="radio-option-title">Keep existing</span>
              <span class="radio-option-desc">Keep your current items and add the new ones.</span>
            </div>
          </label>
          <label>
            <input type="radio" name="import-strategy" value="replace" @change="$event.target.checked && (importStrategy = 'replace')" />
            <div class="radio-option">
              <span class="radio-option-title">Replace existing</span>
              <span class="radio-option-desc">Replace existing items with the backup versions.</span>
            </div>
          </label>
        </div>

        <p v-if="hasConflicts" class="import-preview-safety">
          Your other saved items won't be removed.
        </p>

        <div class="import-preview-actions">
          <button class="btn ghost" @click="cancelPreview">Cancel</button>
          <button class="btn primary" @click="handleImportClick">Import</button>
        </div>
      </div>
    </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.backup-card {
  background: transparent;
  padding: 0;
}
.backup-card h4 {
  margin: 0 0 var(--space-1);
  font-size: var(--text-2xl);
  font-weight: var(--weight-semibold);
  line-height: 1.2;
  color: var(--text-h);
}
.muted {
  color: var(--muted);
  font-size: var(--text-sm);
  margin: 0 0 40px;
}
.actions {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: 32px;
}
/* Reference action buttons: 48px tall, 12px radius, 24px horizontal padding. */
.actions .btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  min-height: calc(var(--control-height) + var(--space-2));
  padding: 0 var(--space-5);
  border-radius: var(--radius);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  transition: background-color 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.3s cubic-bezier(0.4, 0, 0.2, 1), color 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.actions .btn svg { transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
@media (hover: hover) and (pointer: fine) {
  /* Reference behavior: only the icon moves — the Export icon lifts, the
     Import icon drops. */
  .actions .btn:first-of-type:hover svg { transform: translateY(calc(var(--space-1) * -1)); }
  .actions .btn:last-of-type:hover svg { transform: translateY(var(--space-1)); }
}
/* Press feedback stays the shared .btn recipe (no extra override). */
/* Last-backup status: semantic success treatment with the reference pulse
   (SaveLink --success, no reference palette). */
.backup-status {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: fit-content;
  margin: 0;
  padding: var(--space-4) 20px;
  border: 1px solid color-mix(in srgb, var(--success) 35%, var(--border));
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--success) 6%, var(--bg));
  color: var(--text);
  font-size: var(--text-sm);
}
.status-dot {
  position: relative;
  width: var(--space-3);
  height: var(--space-3);
  flex-shrink: 0;
}
/* The solid center dot paints last (pseudo-element), so the pulse can never
   dim or hide it. */
.status-dot::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--success);
}
.status-dot-ping {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--success);
  opacity: .75;
  animation: status-ping 1s cubic-bezier(0, 0, .2, 1) infinite;
}
/* The reference ping: expand to 2× and fade out, repeating indefinitely. */
@keyframes status-ping {
  75%, 100% { transform: scale(2); opacity: 0; }
}
.error {
  color: var(--error);
  font-size: var(--text-xs);
  margin-top: 8px;
}
/* Reduced motion: no pulse, no button/icon movement. */
@media (prefers-reduced-motion: reduce) {
  .status-dot-ping { animation: none; }
  .actions .btn:hover, .actions .btn:active,
  .actions .btn:first-of-type:hover svg,
  .actions .btn:last-of-type:hover svg { transform: none; }
}

/* Import Preview Modal */
.import-preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-panel);
  background: var(--overlay);
  backdrop-filter: blur(var(--overlay-blur));
  -webkit-backdrop-filter: blur(var(--overlay-blur));
  display: grid;
  place-items: center;
  padding: 16px;
  padding-bottom: calc(16px + var(--safe-area-bottom));
}
.import-preview-modal {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  width: 100%;
  max-width: 460px;
  max-height: calc(100vh - 32px);
  max-height: calc(100dvh - 32px - var(--safe-area-bottom));
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 24px 28px;
}
.import-preview-modal h3 {
  margin: 0 0 12px;
  font-size: var(--text-lg);
  color: var(--text-h);
}
.import-preview-summary {
  margin: 0 0 12px;
  font-size: var(--text-sm);
  color: var(--text);
  line-height: var(--leading-normal);
}
.import-preview-summary span {
  display: block;
  margin-top: 4px;
  font-weight: var(--weight-semibold);
  color: var(--text-h);
}
.import-preview-duplicates {
  margin: 16px 0 8px;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-h);
}
.import-preview-counts {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
  font-size: var(--text-sm);
  color: var(--text);
  line-height: 1.8;
}
.import-preview-counts li::before {
  content: '• ';
  color: var(--muted);
}
.import-preview-choice {
  margin: 16px 0 8px;
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-h);
}
.import-preview-radio {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: 20px;
}
.import-preview-radio label {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  transition: all var(--transition-fast);
}
@media (hover: hover) and (pointer: fine){
.import-preview-radio label:hover {
  border-color: var(--accent-border);
  background: var(--muted-bg);
}
}
.import-preview-radio input[type="radio"] {
  accent-color: var(--accent-strong);
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  margin-top: 2px;
}
.radio-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.radio-option-title {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-h);
}
.radio-option-desc {
  font-size: var(--text-xs);
  color: var(--muted);
  line-height: 1.4;
}
.import-preview-safety {
  margin: 16px 0 0;
  font-size: var(--text-xs);
  color: var(--muted);
}
.import-preview-no-conflicts {
  margin: 16px 0 0;
  font-size: var(--text-sm);
  color: var(--muted);
  font-style: italic;
}
.import-preview-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
