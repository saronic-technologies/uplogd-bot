import axios from "axios";
import { summarizeResponseData } from "./responseSummary.js";

const { API_AUTH_TOKEN } = process.env;
const GARAGE_MODE_ENDPOINT = "http://localhost:8010";

function getRequiredEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function sanitizePathSegment(segment) {
  return encodeURIComponent(String(segment || "").trim()) || "unknown";
}

function buildStatusUrl(endpoint, assetId) {
  const trimmedEndpoint = endpoint.replace(/\/+$/u, "");
  const assetSegment = sanitizePathSegment(assetId);
  return `${trimmedEndpoint}/garage_mode/${assetSegment}/status`;
}

function parseDevicesFromStdout(stdout) {
  if (!stdout || typeof stdout !== "string") {
    return [];
  }

  const lines = stdout.split(/\r?\n/u);
  const headerIndex = lines.findIndex((line) =>
    line.trim().toLowerCase().startsWith("device")
  );

  if (headerIndex === -1) {
    return [];
  }

  const devices = [];
  let i = headerIndex + 1;
  // Skip divider lines immediately after the header.
  while (i < lines.length && /^=+/u.test(lines[i].trim())) {
    i += 1;
  }

  for (; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    if (/^=+/u.test(line)) {
      break;
    }

    const parts = line.split(/\s{2,}/u).filter(Boolean);
    if (parts.length < 2) {
      continue;
    }

    const [device, state, ...notesParts] = parts;
    devices.push({
      device,
      state,
      notes: notesParts.join(" "),
    });
  }

  return devices;
}

export async function fetchGarageModeStatus({ assetId, machine, logger }) {
  const endpoint = GARAGE_MODE_ENDPOINT;
  const headers = {
    "Content-Type": "application/json",
    ...(API_AUTH_TOKEN ? { Authorization: `Bearer ${API_AUTH_TOKEN}` } : {}),
  };
  const url = buildStatusUrl(endpoint, assetId);

  try {
    const response = await axios.get(url, {
      headers,
      timeout: 60000,
    });

    const devices = parseDevicesFromStdout(response.data?.stdout);
    return {
      assetId,
      machine,
      success: true,
      statusCode: response.status,
      responseSummary: summarizeResponseData(response.data),
      devices,
    };
  } catch (error) {
    const statusCode = error.response?.status ?? null;
    const responseSummary =
      summarizeResponseData(error.response?.data) ?? error.message;
    logger?.error?.(
      `Failed to fetch garage mode status for ${assetId}`,
      error?.response?.data ?? error
    );

    return {
      assetId,
      machine,
      success: false,
      statusCode,
      responseSummary,
      error: error.message,
    };
  }
}
