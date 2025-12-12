import axios from "axios";

const DEFAULT_WAVE_URL =
  "https://www.ndbc.noaa.gov/data/realtime2/46232.txt";

function normalizeValue(raw) {
  if (raw === undefined || raw === null) {
    return null;
  }

  const trimmed = String(raw).trim();

  if (trimmed === "" || trimmed === "MM" || trimmed === "9999") {
    return null;
  }

  const numeric = Number(trimmed);
  return Number.isNaN(numeric) ? trimmed : numeric;
}

function tokenize(line) {
  return line
    .replace(/^#+\s*/u, "")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

function findFirstLine(lines, predicate) {
  return lines.find((line) => predicate(line)) || null;
}

function resolveTimestamp(fields) {
  const getValue = (names) =>
    fields.find((field) => names.includes(field.name))?.value ?? null;

  const year = getValue(["YYYY", "YY", "yr"]);
  const month = getValue(["MM", "mo"]);
  const day = getValue(["DD", "dy"]);
  const hour = getValue(["hh", "hr"]);
  const minute = getValue(["mm", "mn"]);

  if (
    [year, month, day, hour, minute].some(
      (value) => value === null || Number.isNaN(Number(value))
    )
  ) {
    return null;
  }

  const normalizedYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);
  const date = new Date(
    Date.UTC(
      normalizedYear,
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute)
    )
  );

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseWaveData(rawText) {
  if (typeof rawText !== "string") {
    return null;
  }

  const lines = rawText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3) {
    return null;
  }

  const headerLine = findFirstLine(lines, (line) => line.startsWith("#"));
  const unitsLine = findFirstLine(
    lines.slice(lines.indexOf(headerLine) + 1),
    (line) => line.startsWith("#")
  );
  const dataLine = findFirstLine(lines, (line) => !line.startsWith("#"));

  if (!headerLine || !unitsLine || !dataLine) {
    return null;
  }

  const headers = tokenize(headerLine);
  const units = tokenize(unitsLine);
  const values = tokenize(dataLine);

  const fields = headers.map((name, index) => ({
    name,
    unit: units[index] ?? null,
    raw: values[index] ?? null,
    value: normalizeValue(values[index]),
  }));

  return {
    headers,
    units,
    latest: {
      raw: dataLine,
      fields,
      timestamp: resolveTimestamp(fields),
    },
  };
}

function getWaveUrl() {
  return process.env.SD_WAVE_URL?.trim() || DEFAULT_WAVE_URL;
}

export async function fetchWaves({ logger } = {}) {
  const waveUrl = getWaveUrl();

  try {
    const response = await axios.get(waveUrl, {
      responseType: "text",
      timeout: 20000,
    });

    const parsed = parseWaveData(response.data);

    return {
      success: true,
      url: waveUrl,
      status: response.status,
      data: response.data,
      parsed,
    };
  } catch (error) {
    const status = error?.response?.status ?? null;
    const message =
      error?.response?.data?.message ||
      error?.response?.statusText ||
      error?.message ||
      "Request failed";

    logger?.error?.("Failed to fetch SD wave data", error?.response?.data ?? error);

    return {
      success: false,
      url: waveUrl,
      status,
      error: message,
      data: error?.response?.data ?? null,
    };
  }
}

export function parseWavePreview(rawText) {
  return parseWaveData(rawText);
}
