export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export const USE_MOCK: boolean =
  import.meta.env.VITE_USE_MOCK === 'true'

// Studio surface has its own mock toggle, independent of the agent API.
// Defaults to mock (true) so the studio works with zero backend; set
// VITE_STUDIO_USE_MOCK=false to hit the real /studio backend.
export const STUDIO_USE_MOCK: boolean =
  (import.meta.env.VITE_STUDIO_USE_MOCK ?? 'true') !== 'false'
