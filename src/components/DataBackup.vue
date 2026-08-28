<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  createBackupPayload,
  parseBackupText,
  validateBackupPayload,
  normalizeBackupData,
  getLastBackupAt,
  setLastBackupAt,
} from '../utils/backup.js'

const props = defineProps({
  links: { type: Array, required: true },
  profile: { type: Object, required: true },
  folders: { type: Array, default: () => [] },
  appearance: { type: String, default: 'system' },
  colorScheme: { type: String, default: 'ocean' },
})

const emit = defineEmits(['imported', 'show-toast'])

const fileInput = ref(null)
const lastBackupAt = ref(null)
const error = ref('')

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
    a.download = `save-link-backup-${date}.json`
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

  const confirmed = window.confirm('This will replace your current Save_Link data. Your existing data may be lost. Continue?')
  if (!confirmed) return

  emit('imported', normalized)
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
</style>
