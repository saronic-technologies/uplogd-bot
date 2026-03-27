import {
  appendNotmarSummaryToForecastMessage,
  buildForecastMessage,
} from "../ui/forecast.js";
import {
  prepareBnmBrief,
  prepareBnmBriefWithRetries,
  uploadBnmMap,
} from "./bnmBrief.js";

export function parseForecastCommandOptions(text) {
  const tokens = String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const includeNotmar = tokens.some((token) => token.toLowerCase() === "notmar");
  const normalizedText = tokens
    .filter((token) => token.toLowerCase() !== "notmar")
    .join(" ");

  return {
    includeNotmar,
    normalizedText,
  };
}

export async function buildForecastResponse({
  logger,
  includeNotmar = false,
  slackClient = null,
  channel = null,
  collectForecast,
  forceRefreshBnm = false,
  retryBnm = false,
}) {
  const forecast = await collectForecast({ logger });
  let forecastMessage = buildForecastMessage(forecast);

  if (!includeNotmar) {
    return forecastMessage;
  }

  const bnmResult = retryBnm
    ? await prepareBnmBriefWithRetries({
        logger,
        forceRefresh: forceRefreshBnm,
      })
    : await prepareBnmBrief({
        logger,
        forceRefresh: forceRefreshBnm,
        useRunCache: !forceRefreshBnm,
      });

  forecastMessage = appendNotmarSummaryToForecastMessage(forecastMessage, {
    summaryUrl: bnmResult.summary?.url ?? null,
  });

  if (slackClient && channel) {
    await uploadBnmMap({
      result: bnmResult,
      slackClient,
      channel,
      initialComment: "Daily NOTMAR map",
    });
  }

  logger?.info?.("Uploaded NOTMAR asset for forecast request", {
    mapPath: bnmResult.mapPath ?? null,
    summaryUrl: bnmResult.summary?.url ?? null,
  });

  return forecastMessage;
}
