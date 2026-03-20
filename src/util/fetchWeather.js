import axios from "axios";

const DEFAULT_WEATHER_URL =
  "https://api.weather.gov/gridpoints/SGX/54,13/forecast";
const WEATHER_TIMEOUT_MS = 20000;
const WEATHER_RETRY_ATTEMPTS = Number(process.env.SD_WEATHER_RETRY_ATTEMPTS || 3);
const WEATHER_RETRY_BASE_DELAY_MS = Number(
  process.env.SD_WEATHER_RETRY_BASE_DELAY_MS || 1500
);

function getWeatherUrl() {
  return process.env.SD_WEATHER_URL?.trim() || DEFAULT_WEATHER_URL;
}

function buildWeatherHeaders() {
  return {
    "User-Agent": "uplogd-bot/1.0 (sdforecast command)",
    Accept: "application/ld+json",
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableWeatherError(error) {
  const status = error?.response?.status;
  const code = error?.code;

  if (code === "INVALID_WEATHER_PAYLOAD") {
    return true;
  }

  if (!status) {
    return true;
  }

  return status === 429 || status >= 500;
}

function getForecastPeriods(payload) {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  if (Array.isArray(payload.periods)) {
    return payload.periods;
  }

  if (Array.isArray(payload?.properties?.periods)) {
    return payload.properties.periods;
  }

  return [];
}

export async function fetchWeather({ logger } = {}) {
  const weatherUrl = getWeatherUrl();
  const attempts = Number.isInteger(WEATHER_RETRY_ATTEMPTS) && WEATHER_RETRY_ATTEMPTS > 0
    ? WEATHER_RETRY_ATTEMPTS
    : 3;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await axios.get(weatherUrl, {
        timeout: WEATHER_TIMEOUT_MS,
        headers: buildWeatherHeaders(),
      });
      const periods = getForecastPeriods(response?.data);

      if (periods.length === 0) {
        const invalidPayloadError = new Error(
          "Weather response missing forecast periods"
        );
        invalidPayloadError.code = "INVALID_WEATHER_PAYLOAD";
        invalidPayloadError.response = response;
        throw invalidPayloadError;
      }

      return {
        success: true,
        url: weatherUrl,
        status: response.status,
        data: response.data,
      };
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < attempts && isRetryableWeatherError(error);

      if (shouldRetry) {
        const backoffMs = WEATHER_RETRY_BASE_DELAY_MS * attempt;
        logger?.warn?.("Retrying SD weather fetch", {
          attempt,
          attempts,
          status: error?.response?.status ?? null,
          delayMs: backoffMs,
          url: weatherUrl,
        });
        await delay(backoffMs);
        continue;
      }
    }
  }

  const status = lastError?.response?.status ?? null;
  const message =
    lastError?.response?.data?.message ||
    lastError?.response?.statusText ||
    lastError?.message ||
    "Request failed";

  logger?.error?.("Failed to fetch SD weather data", lastError?.response?.data ?? lastError);

  return {
    success: false,
    url: weatherUrl,
    status,
    error: message,
    data: lastError?.response?.data ?? null,
  };
}
