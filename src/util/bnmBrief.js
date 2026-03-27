import { runDailyBrief } from "../bnm/orchestrator.js";

const DEFAULT_PREP_RETRY_ATTEMPTS = Number(
  process.env.BNM_PREP_RETRY_ATTEMPTS || 3
);
const DEFAULT_PREP_RETRY_DELAY_MS = Number(
  process.env.BNM_PREP_RETRY_DELAY_MS || 15000
);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasUsableBnmResult(result) {
  return Boolean(result?.summary?.url) && Array.isArray(result?.summary?.active_notice_ids);
}

export async function prepareBnmBrief({
  logger,
  storeDir = process.env.BNM_STORE_DIR,
  forceRefresh = false,
  useRunCache = true,
} = {}) {
  return runDailyBrief({
    logger,
    storeDir,
    forceRefresh,
    useRunCache,
  });
}

export async function prepareBnmBriefWithRetries({
  logger,
  storeDir = process.env.BNM_STORE_DIR,
  attempts = DEFAULT_PREP_RETRY_ATTEMPTS,
  delayMs = DEFAULT_PREP_RETRY_DELAY_MS,
  forceRefresh = true,
} = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await prepareBnmBrief({
        logger,
        storeDir,
        forceRefresh,
        useRunCache: !forceRefresh && attempt > 1,
      });
      if (hasUsableBnmResult(result)) {
        logger?.info?.("Prepared BNM brief", {
          attempt,
          summaryUrl: result.summary?.url ?? null,
          mapPath: result.mapPath ?? null,
        });
        return result;
      }
      lastError = new Error("BNM prep returned empty result");
    } catch (error) {
      lastError = error;
      logger?.warn?.("BNM prep attempt failed", {
        attempt,
        attempts,
        error: error?.message ?? String(error),
      });
    }

    if (attempt < attempts) {
      await delay(delayMs);
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("BNM prep failed without a specific error");
}

export async function uploadBnmMap({
  result,
  slackClient,
  channel,
  initialComment = "Daily NOTMAR map",
}) {
  if (!result?.mapPath || !slackClient || !channel) {
    return null;
  }

  return slackClient.files.uploadV2({
    channel_id: channel,
    initial_comment: initialComment,
    file: result.mapPath,
    filename: "sd-bnm-map.png",
  });
}

export function scheduleDailyBnmBrief({
  logger,
  msUntilNextTime,
  formatPacificDateTime,
  storeDir = process.env.BNM_STORE_DIR,
}) {
  const scheduleNext = () => {
    const delay = msUntilNextTime(7, 55);
    const nextFire = new Date(Date.now() + delay);
    logger?.info?.("Scheduling next daily BNM prep", {
      pacificFireTime: formatPacificDateTime(nextFire),
      delayMs: delay,
    });

    setTimeout(async () => {
      try {
        const result = await prepareBnmBriefWithRetries({
          logger,
          storeDir,
        });
        logger?.info?.("Completed scheduled BNM prep", {
          runPath: result.runPath,
          mapPath: result.mapPath,
        });
      } catch (error) {
        logger?.error?.("Failed scheduled BNM brief run", error);
      } finally {
        scheduleNext();
      }
    }, delay);
  };

  scheduleNext();
}
