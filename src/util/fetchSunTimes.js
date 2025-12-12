import axios from "axios";

const DEFAULT_SUN_ENDPOINT = "https://api.sunrise-sunset.org/json";
const DEFAULT_TIME_ZONE = "America/Los_Angeles";
const DEFAULT_LAT = "32.7157";
const DEFAULT_LNG = "-117.1611";

function resolveEnv(name, fallback) {
  return process.env[name]?.trim() || fallback;
}

function getPacificDateYYYYMMDD() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function formatToTimezone(isoString, timeZone, withDate = false) {
  if (!isoString) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  try {
    const date = new Date(isoString);
    const parts = formatter.formatToParts(date);
    const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (withDate) {
      return `${lookup.year}-${lookup.month}-${lookup.day} ${lookup.hour}:${lookup.minute}`;
    }
    return `${lookup.hour}:${lookup.minute}`;
  } catch (error) {
    return null;
  }
}

export async function fetchSunTimes({ logger } = {}) {
  const url = resolveEnv("SD_SUN_ENDPOINT", DEFAULT_SUN_ENDPOINT);
  const timeZone = resolveEnv("SD_SUN_TIMEZONE", DEFAULT_TIME_ZONE);
  const lat = resolveEnv("SD_SUN_LAT", DEFAULT_LAT);
  const lng = resolveEnv("SD_SUN_LNG", DEFAULT_LNG);
  const date = getPacificDateYYYYMMDD();

  try {
    const response = await axios.get(url, {
      params: {
        lat,
        lng,
        date,
        formatted: 0,
      },
      timeout: 15000,
    });

    if (response.data?.status !== "OK" || !response.data?.results) {
      throw new Error(`Sunrise-sunset API error: ${response.data?.status ?? "unknown"}`);
    }

    const results = response.data.results;
    return {
      date,
      lat,
      lng,
      timezone: timeZone,
      sunriseLocal: formatToTimezone(results.sunrise, timeZone, true),
      sunsetLocal: formatToTimezone(results.sunset, timeZone, true),
      solarNoonLocal: formatToTimezone(results.solar_noon, timeZone, true),
      dayLengthSeconds: results.day_length ?? null,
      raw: results,
    };
  } catch (error) {
    logger?.error?.("Failed to fetch sunrise/sunset data", error?.response?.data ?? error);
    throw error;
  }
}
