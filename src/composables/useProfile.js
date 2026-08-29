import { ref, watch } from 'vue'
import { repository } from '../storage/repository.js'
import { bootState } from '../storage/migration.js'

export function useProfile() {
  const profile = ref(bootState.ready && bootState.profile ? { ...bootState.profile } : { name: 'Local User', bio: 'Local-first bookmark manager' })

  watch(profile, (val) => repository.saveProfile(val).catch((err) => console.warn('saveProfile failed', err)), { deep: true })

  function updateProfile(patch) {
    profile.value = { ...profile.value, ...patch }
  }

  function setProfile(newProfile) {
    if (newProfile && typeof newProfile === 'object' && !Array.isArray(newProfile)) {
      profile.value = { ...newProfile }
    } else {
      profile.value = { name: 'Local User', bio: 'Local-first bookmark manager' }
    }
  }

  return { profile, updateProfile, setProfile }
}
