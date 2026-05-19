import { agentConfig } from './agentConfig';

export const MIN_RELEVANT_SCORE = agentConfig.scoring.minRelevantScore;
export const HIGH_SCORE_THRESHOLD = agentConfig.scoring.highScoreThreshold;
export const PROPOSAL_MIN_SCORE = agentConfig.scoring.proposalMinScore;

export const CRON_EVERY_15_MIN = agentConfig.scheduler.cronEvery15Min;
export const CRON_MIDNIGHT = agentConfig.scheduler.cronMidnight;
export const LOCK_TIMEOUT_MINUTES = agentConfig.scheduler.lockTimeoutMinutes;

export const PIPELINE_BATCH_SIZE = agentConfig.pipeline.batchSize;

export const SESSION_EXPIRY_HOURS = agentConfig.sessionManager.expiryHours;
