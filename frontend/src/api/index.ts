import { USE_MOCK } from '../config'
import * as live from './client'
import * as mock from './mock'

export const api = USE_MOCK
  ? {
      getAgents:  mock.getAgents,
      triggerRun: mock.triggerRun,
      getRun:     mock.getRun,
      getHealth:  mock.getHealth,
      streamRun:  mock.streamRun,
    }
  : {
      getAgents:  live.getAgents,
      triggerRun: live.triggerRun,
      getRun:     live.getRun,
      getHealth:  live.getHealth,
      streamRun:  live.streamRun,
    }
