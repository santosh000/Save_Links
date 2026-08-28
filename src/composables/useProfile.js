import { ref, watch } from 'vue'
import { loadProfile, saveProfile } from '../utils/storage.js'

export function useProfile() {
  const profile = ref(loadProfile())

  watch(profile, (val) => saveProfile(val), { deep: true })

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
