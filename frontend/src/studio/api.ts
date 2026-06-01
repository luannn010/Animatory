/**
 * Studio data-access facade.
 *
 * Components import `studioApi` from here and never touch the mock or HTTP
 * layers directly. The implementation is chosen at load time by
 * `STUDIO_USE_MOCK` (default: mock), so swapping to the real backend is a
 * single env flag with no UI changes.
 */
import { STUDIO_USE_MOCK } from '../config'
import { studioApi as mockStudioApi } from './mockApi'
import { studioHttpApi } from './httpApi'

export const studioApi = STUDIO_USE_MOCK ? mockStudioApi : studioHttpApi

// Live-only model seams (parse job + voice preview) for later wiring.
export { studioLive } from './httpApi'
export type { ParseJob, VoicePreview } from './httpApi'
