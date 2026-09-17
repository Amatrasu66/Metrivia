import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import {
  DEFAULT_THEME_ID,
  applyThemeTokens,
  getSystemMode,
  getThemeById,
  resolveAppearance,
  resolveThemeId,
  subscribeToSystemMode,
} from "@/lib/themes"
import { APPEARANCES } from "@/lib/themes/theme-utils"
import {
  APPEARANCE_STORAGE_KEY,
  THEME_ID_STORAGE_KEY,
  readInitialAppearance,
  readInitialThemeId,
  writeSettingsKey,
} from "@/lib/app-settings-storage"
import {
  getHapticSettings,
  getHapticSettingsVersion,
  resetHapticSettings,
  subscribeHapticSettings,
  updateHapticSettings,
} from "@/lib/haptic-settings"
import { SettingsContext } from "@/hooks/useAppSettings"

/**
 * Application settings provider: theme palette + light/dark/system
 * appearance + haptic preferences, all persisted to localStorage.
 *
 * - Theme application is a side effect here (and only here): changing the
 *   theme or the effective mode rewrites the documentElement custom
 *   properties instantly, with no reload and no remount.
 * - Haptic state itself lives in `@/lib/haptic-settings` (readable at fire
 *   time without a render); this provider mirrors its version so Settings
 *   UI re-renders on change.
 */
export function SettingsProvider({ children }) {
  const [themeId, setThemeIdState] = useState(readInitialThemeId)
  const [appearance, setAppearanceState] = useState(readInitialAppearance)
  const [systemMode, setSystemMode] = useState(getSystemMode)
  const hapticVersion = useSyncExternalStore(
    subscribeHapticSettings,
    getHapticSettingsVersion,
    getHapticSettingsVersion,
  )

  useEffect(() => subscribeToSystemMode(setSystemMode), [])

  const effectiveMode =
    appearance === APPEARANCES.SYSTEM ? systemMode : appearance

  useEffect(() => {
    applyThemeTokens(themeId, effectiveMode)
  }, [themeId, effectiveMode])

  const setTheme = useCallback((nextId) => {
    const resolved = resolveThemeId(nextId)
    setThemeIdState(resolved)
    writeSettingsKey(THEME_ID_STORAGE_KEY, resolved)
  }, [])

  const setAppearance = useCallback((next) => {
    const resolved = resolveAppearance(next)
    setAppearanceState(resolved)
    writeSettingsKey(APPEARANCE_STORAGE_KEY, resolved)
  }, [])

  const setHapticsEnabled = useCallback((enabled) => {
    updateHapticSettings(
      { enabled: enabled === true },
      { persist: "immediate" },
    )
  }, [])

  const setHapticIntensity = useCallback((intensity) => {
    updateHapticSettings({ intensity }, { persist: "debounced" })
  }, [])

  const setHapticCategory = useCallback((categoryId, value) => {
    updateHapticSettings(
      { categories: { [categoryId]: value } },
      { persist: "debounced" },
    )
  }, [])

  const resetSettings = useCallback(() => {
    setThemeIdState(DEFAULT_THEME_ID)
    writeSettingsKey(THEME_ID_STORAGE_KEY, DEFAULT_THEME_ID)
    setAppearanceState(APPEARANCES.SYSTEM)
    writeSettingsKey(APPEARANCE_STORAGE_KEY, APPEARANCES.SYSTEM)
    resetHapticSettings()
  }, [])

  const value = useMemo(
    () => ({
      /** Active theme registry object (never null). */
      theme: getThemeById(themeId) ?? getThemeById(DEFAULT_THEME_ID),
      themeId,
      setTheme,
      appearance,
      setAppearance,
      /** Concrete "light"/"dark" currently rendered. */
      effectiveMode,
      /** Current sanitized haptic settings snapshot. */
      haptics: getHapticSettings(),
      setHapticsEnabled,
      setHapticIntensity,
      setHapticCategory,
      resetSettings,
    }),
    // hapticVersion re-resolves the snapshot after store updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      themeId,
      appearance,
      effectiveMode,
      hapticVersion,
      setTheme,
      setAppearance,
      setHapticsEnabled,
      setHapticIntensity,
      setHapticCategory,
      resetSettings,
    ],
  )

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}
