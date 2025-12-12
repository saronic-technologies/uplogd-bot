import "dotenv/config";
import bolt from "@slack/bolt";
import {
  ACTION_IDS,
  buildErrorModal,
  buildSubmissionModal,
  MODAL_CALLBACK_ID,
  NO_ASSET_VALUE,
} from "./ui/modal.js";
import {
  buildSubmissionMessage,
  buildChannelSummaryMessage,
  buildStatusOnlyMessage,
  createSubmissionContext,
} from "./ui/message.js";
import { buildForecastMessage } from "./ui/forecast.js";
import {
  prepareSubmissionDetails,
  submitFormPayload,
} from "./util/submitForm.js";
import { fetchAssets } from "./util/fetchAssets.js";
import { fetchStatus } from "./util/fetchStatus.js";
import { fetchTodaysTides } from "./util/fetchTides.js";
import { fetchSunTimes } from "./util/fetchSunTimes.js";
import { fetchWaves } from "./util/fetchWaves.js";
import { fetchWeather } from "./util/fetchWeather.js";

const { App, LogLevel } = bolt;
const requiredEnv = [
  "SLACK_SIGNING_SECRET",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
];
const shortcutCallbackId = process.env.SHORTCUT_CALLBACK_ID || "manage_uplogd";
const sdForecastCommand = process.env.SD_FORECAST_COMMAND || "/sdforecast";
const sdForecastChannel = process.env.SD_FORECAST_CHANNEL || null;
let app;

function ensureEnv() {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

async function stopApp() {
  if (!app) {
    return;
  }

  try {
    await app.stop();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to stop Slack app cleanly", error);
  } finally {
    app = undefined;
  }
}

function setupShutdownHandlers() {
  const stopAndExit = (code) =>
    stopApp()
      .catch(() => undefined)
      .finally(() => {
        process.exit(code);
      });

  process.once("SIGINT", () => stopAndExit(0));
  process.once("SIGTERM", () => stopAndExit(0));
  process.once("SIGUSR2", () => {
    stopApp()
      .catch(() => undefined)
      .finally(() => {
        // Allow nodemon to restart the process after the socket is closed.
        process.kill(process.pid, "SIGUSR2");
      });
  });
}

function toResult(settled) {
  if (!settled) {
    return null;
  }
  if (settled.status === "fulfilled") {
    return settled.value;
  }
  const error = settled.reason;
  return {
    success: false,
    status: error?.response?.status ?? null,
    error: error?.message ?? "Failed",
    data: error?.response?.data ?? null,
  };
}

function normalizeAncillary(raw) {
  if (!raw) return null;
  if (raw.success === undefined) {
    return { success: true, status: 200, data: raw };
  }
  return raw;
}

async function collectForecast({ logger }) {
  const [waveResult, weatherResult, tidesResult, sunResult] =
    await Promise.allSettled([
      fetchWaves({ logger }),
      fetchWeather({ logger }),
      fetchTodaysTides({ logger }),
      fetchSunTimes({ logger }),
    ]);

  const wave = toResult(waveResult);
  const weather = toResult(weatherResult);
  const tides = normalizeAncillary(toResult(tidesResult));
  const sun = normalizeAncillary(toResult(sunResult));

  if (wave && !wave.success) {
    logger?.error?.("Failed to fetch SD wave data", wave.error ?? wave);
  }
  if (weather && !weather.success) {
    logger?.error?.("Failed to fetch SD weather data", weather.error ?? weather);
  }
  if (tides && !tides.success) {
    logger?.error?.("Failed to fetch SD tides data", tides.error ?? tides);
  }
  if (sun && !sun.success) {
    logger?.error?.("Failed to fetch SD sun data", sun.error ?? sun);
  }

  return { wave, weather, tides, sun };
}

function msUntilNextHour(hour = 8) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

function msUntilNextTime(hour, minute = 0) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

function scheduleDailyForecast({ client, logger }) {
  if (!sdForecastChannel) {
    logger?.info?.("SD_FORECAST_CHANNEL not set; skipping daily forecast schedule.");
    return;
  }

  const scheduleNext = () => {
    const delay = msUntilNextHour(8);
    setTimeout(async () => {
      try {
        const today = new Date();
        const day = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
        const isWeekday = day >= 1 && day <= 5;

        if (isWeekday) {
          const forecast = await collectForecast({ logger });
          const message = buildForecastMessage(forecast);
          await client.chat.postMessage({
            channel: sdForecastChannel,
            text: message.text,
            blocks: message.blocks,
          });
          logger?.info?.("Posted scheduled forecast to channel", {
            channel: sdForecastChannel,
          });
        } else {
          logger?.info?.("Skipping scheduled forecast (weekend).");
        }
      } catch (error) {
        logger?.error?.("Failed to post scheduled forecast", error);
      } finally {
        scheduleNext();
      }
    }, delay);
  };

  scheduleNext();
}

function parseOneTimeSchedule(text) {
  if (!text) return null;
  const normalized = text.trim();
  const withoutKeyword = normalized.replace(/^schedule\s*/i, "").trim();
  if (!withoutKeyword) return null;

  const inMatch = withoutKeyword.match(/^in\s+(\d+)\s*(m|min|mins|minutes)?$/i);
  if (inMatch) {
    const minutes = Number(inMatch[1]);
    if (!Number.isNaN(minutes) && minutes > 0) {
      return {
        delayMs: minutes * 60 * 1000,
        label: `in ${minutes}m`,
      };
    }
  }

  const atMatch = withoutKeyword.match(/^(?:at\s*)?(\d{1,2}):(\d{2})$/i);
  if (atMatch) {
    const hour = Number(atMatch[1]);
    const minute = Number(atMatch[2]);
    if (
      Number.isInteger(hour) &&
      Number.isInteger(minute) &&
      hour >= 0 &&
      hour <= 23 &&
      minute >= 0 &&
      minute <= 59
    ) {
      const delayMs = msUntilNextTime(hour, minute);
      const paddedMinute = String(minute).padStart(2, "0");
      return {
        delayMs,
        label: `at ${hour}:${paddedMinute} (local)`,
      };
    }
  }

  return null;
}

function scheduleOneTimeForecast({ client, logger, channel, delayMs }) {
  setTimeout(async () => {
    try {
      const forecast = await collectForecast({ logger });
      const message = buildForecastMessage(forecast);
      await client.chat.postMessage({
        channel,
        text: message.text,
        blocks: message.blocks,
      });
      logger?.info?.("Posted one-time scheduled forecast", {
        channel,
      });
    } catch (error) {
      logger?.error?.("Failed to post one-time scheduled forecast", error);
    }
  }, delayMs);
}


async function start() {
  ensureEnv();

  app = new App({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel:
      process.env.NODE_ENV === "production" ? LogLevel.INFO : LogLevel.DEBUG,
  });

  setupShutdownHandlers();

  app.shortcut(shortcutCallbackId, async ({ ack, body, client, logger }) => {
    await ack();

    try {
      const assets = await fetchAssets({ logger });

      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildSubmissionModal({ userId: body.user?.id, assets }),
      });
    } catch (error) {
      logger.error("Failed to open modal from shortcut", error);

      try {
        await client.views.open({
          trigger_id: body.trigger_id,
          view: buildErrorModal(
            "Unable to load assets. Please try again later."
          ),
        });
      } catch (openError) {
        logger.error("Failed to open error modal", openError);
      }
    }
  });

  app.action(ACTION_IDS.asset, async ({ ack, body, client, logger }) => {
    await ack();

    try {
      const selectedOptionRaw = body.actions?.[0]?.selected_option?.value;
      const selectedAssetId =
        selectedOptionRaw && selectedOptionRaw !== NO_ASSET_VALUE
          ? selectedOptionRaw
          : null;
      const metadata = body.view?.private_metadata
        ? JSON.parse(body.view.private_metadata)
        : {};
      const assets = await fetchAssets({ logger });

      await client.views.update({
        view_id: body.view?.id,
        hash: body.view?.hash,
        view: buildSubmissionModal({
          userId: metadata.openedBy ?? body.user?.id,
          assets,
          selectedAssetId,
          viewState: body.view?.state,
        }),
      });
    } catch (error) {
      logger.error("Failed to update modal after asset selection", error);
    }
  });

  app.view(MODAL_CALLBACK_ID, async ({ ack, body, view, client, logger }) => {
    await ack();

    try {
      const preparedSubmission = await prepareSubmissionDetails({ view, logger });

      if (!preparedSubmission) {
        return;
      }

      const dmChannelOverride = process.env.UPLOGD_DM_RECIPIENT || null;
      const dmChannel = dmChannelOverride || body.user?.id || null;
      const updatesChannel = process.env.UPLOGD_UPDATES_CHANNEL || null;
      const requestedBy = {
        id: body.user?.id ?? null,
        username: body.user?.username ?? null,
        realName: body.user?.real_name ?? body.user?.name ?? null,
      };

      const pendingResults = preparedSubmission.machineTargets.map(
        ({ assetId, machine }) => ({
          assetId,
          machine,
          success: null,
          responseSummary: "Waiting for uplogd…",
        })
      );

      let dmMessage;
      let dmMessageChannel;

      if (dmChannel) {
        const pendingContext = createSubmissionContext({
          ...preparedSubmission,
          results: pendingResults,
          pendingRequest: true,
          requestedBy,
          responseMode: "update",
        });
        const pendingMessage = buildSubmissionMessage(pendingContext);

        try {
          dmMessage = await client.chat.postMessage({
            channel: dmChannel,
            ...pendingMessage,
          });
          dmMessageChannel = dmMessage?.channel ?? dmChannel;
        } catch (dmError) {
          logger.error("Failed to send initial DM", dmError);
        }
      } else {
        logger.warn("Unable to DM submission summary: missing user id");
      }

      if (updatesChannel) {
        const channelContext = createSubmissionContext({
          ...preparedSubmission,
          results: pendingResults,
          requestedBy,
          responseMode: "ephemeral",
        });
        const channelMessage = buildChannelSummaryMessage(channelContext);

        try {
          await client.chat.postMessage({
            channel: updatesChannel,
            ...channelMessage,
          });
        } catch (channelError) {
          logger.error("Failed to post update to channel", channelError);
        }
      }

      const summary = await submitFormPayload({
        user: body.user,
        team: body.team,
        view,
        logger,
        preparedSubmission,
      });

      if (!summary) {
        return;
      }

      const finalContext = createSubmissionContext({
        ...summary,
        pendingRequest: false,
        requestedBy: summary?.requestedBy?.id ? summary.requestedBy : requestedBy,
        responseMode: "update",
      });
      const finalMessage = buildSubmissionMessage(finalContext);

      if (!dmChannel) {
        return;
      }

      if (!dmChannel) {
        return;
      }

      if (dmMessage?.ts && dmMessageChannel) {
        await client.chat.update({
          channel: dmMessageChannel,
          ts: dmMessage.ts,
          ...finalMessage,
        });
        return;
      }

      await client.chat.postMessage({
        channel: dmChannel,
        ...finalMessage,
      });
    } catch (error) {
      logger.error("Failed to forward modal submission", error);
    }
  });

  app.action(
    ACTION_IDS.statusCheck,
    async ({ ack, body, client, logger, respond }) => {
      await ack();

      const action = body.actions?.[0];

      if (!action?.value) {
        logger.warn("Status check action missing value payload");
        return;
      }

      let context;

      try {
        context = JSON.parse(action.value);
      } catch (error) {
        logger.error("Unable to parse status button payload", error);
        return;
      }

      const responseMode =
        context?.responseMode === "ephemeral" ? "ephemeral" : "update";
      if (context?.pendingStatusCheck) {
        logger.info("Status check requested while previous check in progress.");
        return;
      }
      const targets = Array.isArray(context?.results) ? context.results : [];

      if (targets.length === 0) {
        logger.warn("Status check invoked without targets");
        return;
      }

      const channel =
        body.container?.channel_id ||
        body.channel?.id ||
        body.message?.channel ||
        body.user?.id;
      const ts = body.message?.ts;

      if (responseMode === "update" && (!channel || !ts)) {
        logger.warn("Cannot update status message: missing channel or ts");
        return;
      }

      if (responseMode === "ephemeral" && (!channel || !body.user?.id)) {
        logger.warn("Cannot send ephemeral status: missing channel or user");
        return;
      }

      const baseContext = {
        ...context,
        statuses: Array.isArray(context?.statuses) ? context.statuses : [],
      };

      if (responseMode === "update") {
        const progressMessage = buildSubmissionMessage({
          ...baseContext,
          pendingStatusCheck: true,
        });

        try {
          await client.chat.update({
            channel,
            ts,
            ...progressMessage,
          });
        } catch (updateError) {
          logger.error("Failed to show status progress indicator", updateError);
        }
      } else {
        const channelProgress = buildChannelSummaryMessage({
          ...baseContext,
          pendingStatusCheck: true,
        });

        try {
          await client.chat.update({
            channel,
            ts,
            ...channelProgress,
          });
        } catch (channelUpdateError) {
          logger.error("Failed to show channel status progress", channelUpdateError);
        }
      }

      const checkedAt = new Date().toISOString();
      const statusResults = await Promise.allSettled(
        targets.map((item) =>
          fetchStatus({
            assetId: item.assetId,
            machine: item.machine,
            logger,
          })
        )
      );

      const statuses = statusResults.map((result, index) => {
        if (result.status === "fulfilled") {
          return {
            ...result.value,
            checkedAt,
          };
        }

        const fallbackTarget = targets[index];
        const reason = result.reason instanceof Error ? result.reason : null;

        logger.error("Status check request failed", result.reason);

        return {
          assetId: fallbackTarget?.assetId ?? "unknown",
          machine: fallbackTarget?.machine ?? null,
          success: false,
          statusCode: null,
          responseSummary:
            reason?.message ?? "Unable to fetch latest status right now.",
          checkedAt,
        };
      });

      const finalContext = {
        ...baseContext,
        statuses,
        pendingStatusCheck: false,
      };

      if (responseMode === "update") {
        const message = buildSubmissionMessage(finalContext);
        await client.chat.update({
          channel,
          ts,
          ...message,
        });
        return;
      }

      await client.chat.update({
        channel,
        ts,
        ...buildChannelSummaryMessage(finalContext),
      });

      const finalEphemeral = buildStatusOnlyMessage(finalContext);

      if (typeof respond === "function") {
        try {
          await respond({
            response_type: "ephemeral",
            replace_original: false,
            ...finalEphemeral,
          });
          return;
        } catch (finalRespondError) {
          logger.error("Failed to send final status via respond", finalRespondError);
        }
      }

      await client.chat.postEphemeral({
        channel,
        user: body.user?.id,
        ...finalEphemeral,
      });
    }
  );

  app.command(sdForecastCommand, async ({ ack, respond, logger, body }) => {
    await ack();

    try {
      const commandText = (body?.text ?? "").trim();
      const schedule = parseOneTimeSchedule(commandText);

      if (schedule && body?.channel_id) {
        scheduleOneTimeForecast({
          client: app.client,
          logger,
          channel: body.channel_id,
          delayMs: schedule.delayMs,
        });
        await respond({
          response_type: "ephemeral",
          text: `Scheduled forecast ${schedule.label} for <#${body.channel_id}>.`,
        });
        return;
      }

      const forecast = await collectForecast({ logger });
      const message = buildForecastMessage(forecast);
      await respond(message);
    } catch (error) {
      logger.error("Failed to fulfill /sdforecast request", error);
      await respond({
        response_type: "ephemeral",
        text:
          "Unable to fetch San Diego forecast right now. Try again in a moment.",
      });
    }
  });

  await app.start();
  // eslint-disable-next-line no-console
  console.log("⚡️ Slack Bolt app (Socket Mode) is running!");

  scheduleDailyForecast({ client: app.client, logger: app.logger });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Unable to start Slack app", error);
  process.exitCode = 1;
});
