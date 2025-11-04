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
  createSubmissionContext,
} from "./ui/message.js";
import { submitFormPayload } from "./util/submitForm.js";
import { fetchAssets } from "./util/fetchAssets.js";
import { fetchStatus } from "./util/fetchStatus.js";

const { App, LogLevel } = bolt;
const requiredEnv = [
  "SLACK_SIGNING_SECRET",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
];
const shortcutCallbackId = process.env.SHORTCUT_CALLBACK_ID || "manage_uplogd";
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
      const summary = await submitFormPayload({
        user: body.user,
        team: body.team,
        view,
        logger,
      });

      if (!summary) {
        return;
      }

      const context = createSubmissionContext(summary);
      const message = buildSubmissionMessage(context);
      const channel = body.user?.id;

      if (!channel) {
        logger.warn("Unable to send submission summary: missing user id");
        return;
      }

      await client.chat.postMessage({
        channel,
        ...message,
      });
    } catch (error) {
      logger.error("Failed to forward modal submission", error);
    }
  });

  app.action(
    ACTION_IDS.statusCheck,
    async ({ ack, body, client, logger }) => {
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

      if (!channel || !ts) {
        logger.warn("Cannot update status message: missing channel or ts");
        return;
      }

      const previousStatuses = Array.isArray(context?.statuses)
        ? context.statuses
        : [];
      context.pendingStatusCheck = true;
      context.statuses = previousStatuses;

      try {
        const progressMessage = buildSubmissionMessage(context);
        await client.chat.update({
          channel,
          ts,
          ...progressMessage,
        });
      } catch (updateError) {
        logger.error("Failed to show status progress indicator", updateError);
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

      context.statuses = statuses;
      context.pendingStatusCheck = false;
      const message = buildSubmissionMessage(context);

      await client.chat.update({
        channel,
        ts,
        ...message,
      });
    }
  );

  await app.start();
  // eslint-disable-next-line no-console
  console.log("⚡️ Slack Bolt app (Socket Mode) is running!");
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Unable to start Slack app", error);
  process.exitCode = 1;
});
