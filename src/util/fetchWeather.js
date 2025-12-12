import axios from "axios";

const DEFAULT_WEATHER_URL =
  "https://api.weather.gov/gridpoints/SGX/54,13/forecast";

function getWeatherUrl() {
  return process.env.SD_WEATHER_URL?.trim() || DEFAULT_WEATHER_URL;
}

function buildWeatherHeaders() {
  return {
    "User-Agent": "uplogd-bot/1.0 (sdforecast command)",
    Accept: "application/ld+json",
  };
}

export async function fetchWeather({ logger } = {}) {
  const weatherUrl = getWeatherUrl();

  try {
    const response = await axios.get(weatherUrl, {
      timeout: 20000,
      headers: buildWeatherHeaders(),
    });

    return {
      success: true,
      url: weatherUrl,
      status: response.status,
      data: response.data,
    };
  } catch (error) {
    const status = error?.response?.status ?? null;
    const message =
      error?.response?.data?.message ||
      error?.response?.statusText ||
      error?.message ||
      "Request failed";

    logger?.error?.("Failed to fetch SD weather data", error?.response?.data ?? error);

    return {
      success: false,
      url: weatherUrl,
      status,
      error: message,
      data: error?.response?.data ?? null,
    };
  }
}
