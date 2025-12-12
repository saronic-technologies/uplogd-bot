import axios from "axios";

const DEFAULT_TIDE_ENDPOINT =
  "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const DEFAULT_TIDE_STATION = "9410170"; // San Diego
const DEFAULT_TIDE_DATUM = "MLLW";
const DEFAULT_TIDE_TIME_ZONE = "lst_ldt";
const DEFAULT_TIDE_UNITS = "english";
const DEFAULT_TIDE_INTERVAL = "hilo";

function getPacificDateYYYYMMDD() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}${lookup.month}${lookup.day}`;
}

function resolveEnv(name, fallback) {
  return process.env[name]?.trim() || fallback;
}

export async function fetchTodaysTides({ logger } = {}) {
  const today = getPacificDateYYYYMMDD();
  const url = resolveEnv("SD_TIDE_ENDPOINT", DEFAULT_TIDE_ENDPOINT);

  const params = {
    product: "predictions",
    application: "uplogd-bot",
    begin_date: today,
    end_date: today,
    datum: resolveEnv("SD_TIDE_DATUM", DEFAULT_TIDE_DATUM),
    station: resolveEnv("SD_TIDE_STATION", DEFAULT_TIDE_STATION),
    time_zone: resolveEnv("SD_TIDE_TIME_ZONE", DEFAULT_TIDE_TIME_ZONE),
    units: resolveEnv("SD_TIDE_UNITS", DEFAULT_TIDE_UNITS),
    interval: resolveEnv("SD_TIDE_INTERVAL", DEFAULT_TIDE_INTERVAL),
    format: "json",
  };

  try {
    const response = await axios.get(url, { params });

    if (!response.data || !Array.isArray(response.data.predictions)) {
      throw new Error("Unexpected response format from NOAA tides API");
    }

    return response.data.predictions.map((prediction) => ({
      time: prediction.t,
      heightFt:
        prediction.v !== undefined ? Number.parseFloat(prediction.v) : null,
      type: prediction.type === "H" ? "High" : "Low",
      raw: prediction,
    }));
  } catch (error) {
    logger?.error?.("Error fetching tides", error?.response?.data ?? error);
    throw error;
  }
}
