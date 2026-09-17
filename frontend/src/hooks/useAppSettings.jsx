import { createContext, useContext } from "react"

/**
 * Shared settings context object. Exported from this hook-only module (no
 * components) so the provider component can live in SettingsProvider.jsx
 * without tripping react-refresh's component-only export rule.
 */
export const SettingsContext = createContext(null)

/** Access app settings. Must be used inside <SettingsProvider>. */
export function useAppSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) {
    throw new Error("useAppSettings must be used inside <SettingsProvider>")
  }
  return ctx
}
