<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  createBackupPayload,
  parseBackupText,
  validateBackupPayload,
  normalizeBackupData,
  getLastBackupAt,
  setLastBackupAt,
  mergeImportData,
} from '../utils/backup.js'

const props = defineProps({
  links: { type: Array, required: true },
  profile: { type: Object, required: true },
  folders: { type: Array, default: () => [] },
  appearance: { type: String, default: 'system' },
  colorScheme: { type: String, default: 'ocean' },
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
    const payload = createBackupPayload({ links: props.links, profile: props.profile, folders: props.folders, appearance: props.appearance, colorScheme: props.colorScheme })
    const json = JSON.stringify(payload, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const date = new Date().toISOString().slice(0, 10)
    a.download = `save-links-backup-${date}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    const now = new Date().toISOString()
    setLastBackupAt(now)
    lastBackupAt.value = now
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

  const { data, error: parseError } = parseBackupText(text)
  if (parseError) {
    error.value = parseError
    emit('show-toast', parseError)
    return
  }

  const validation = validateBackupPayload(data)
  if (!validation.valid) {
    error.value = validation.error
    emit('show-toast', validation.error)
    return
  }

  // normalize (handles malformed records safely)
  let normalized
  try {
    normalized = normalizeBackupData(data)
  } catch {
    error.value = 'Invalid backup: malformed records'
    emit('show-toast', error.value)
    return
  }

  // Check for duplicates using mergeImportData
  const preview = mergeImportData(
    props.links,
    props.folders,
    normalized.links,
    normalized.folders
  )

  // If no duplicates, proceed directly with skip strategy (additive import)
  if (preview.counts.links.duplicate === 0 && preview.counts.folders.duplicate === 0) {
    pendingImport.value = { data: normalized, strategy: 'skip' }
    importPreview.value = null
    emit('import-request', { data: normalized, strategy: 'skip' })
    return
  }

  // Duplicates found - show preview modal
  pendingImport.value = { data: normalized }
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
      <button class="btn" @click="triggerExport">Export Backup</button>
      <button class="btn" @click="triggerImport">Import Backup</button>
      <input ref="fileInput" type="file" accept=".json,application/json" style="display:none" @change="handleImport" />
    </div>
    <p v-if="lastBackupAt" class="muted small">Last backup: {{ formattedLastBackup }}</p>
    <p v-if="error" class="error small">{{ error }}</p>
  </section>

  <!-- Import Preview Modal -->
  <Teleport to="body">
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
  </Teleport>
</template>

<style scoped>
.backup-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px;
}
.backup-card h4 {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--text-h);
}
.muted {
  color: var(--muted);
  font-size: 13px;
  margin: 0;
}
.muted.small {
  font-size: 12px;
  margin-top: 10px;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.btn {
  appearance: none;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text-h);
  padding: 8px 12px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.btn:hover {
  border-color: var(--accent-border);
  box-shadow: var(--shadow);
}
.error {
  color: #ef4444;
  font-size: 12px;
  margin-top: 8px;
}

/* Import Preview Modal */
.import-preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: rgba(15, 23, 42, 0.5);
  display: grid;
  place-items: center;
  padding: 16px;
}
.import-preview-modal {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  width: 100%;
  max-width: 460px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 24px 28px;
}
.import-preview-modal h3 {
  margin: 0 0 12px;
  font-size: 18px;
  color: var(--text-h);
}
.import-preview-summary {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text);
  line-height: 1.5;
}
.import-preview-summary span {
  display: block;
  margin-top: 4px;
  font-weight: 600;
  color: var(--text-h);
}
.import-preview-duplicates {
  margin: 16px 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-h);
}
.import-preview-counts {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
  font-size: 13px;
  color: var(--text);
  line-height: 1.8;
}
.import-preview-counts li::before {
  content: '• ';
  color: var(--muted);
}
.import-preview-choice {
  margin: 16px 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-h);
}
.import-preview-radio {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
}
.import-preview-radio label {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  transition: all 0.15s;
}
.import-preview-radio label:hover {
  border-color: var(--accent-border);
  background: var(--muted-bg);
}
.import-preview-radio input[type="radio"] {
  accent-color: var(--accent);
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
  font-size: 13px;
  font-weight: 600;
  color: var(--text-h);
}
.radio-option-desc {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
}
.import-preview-safety {
  margin: 16px 0 0;
  font-size: 12px;
  color: var(--muted);
}
.import-preview-no-conflicts {
  margin: 16px 0 0;
  font-size: 13px;
  color: var(--muted);
  font-style: italic;
}
.import-preview-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
