import axios from "axios";
import { summarizeResponseData } from "./responseSummary.js";

const { API_ENDPOINT, API_AUTH_TOKEN } = process.env;

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
  const boatSegment = sanitizePathSegment(assetId);
  return `${trimmedEndpoint}/uplogd/${boatSegment}/status`;
}

export async function fetchStatus({ assetId, machine, logger }) {
  const endpoint = getRequiredEnv("API_ENDPOINT", API_ENDPOINT);
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

    return {
      assetId,
      machine,
      success: true,
      statusCode: response.status,
      responseSummary: summarizeResponseData(response.data),
    };
  } catch (error) {
    const statusCode = error.response?.status ?? null;
    const responseSummary =
      summarizeResponseData(error.response?.data) ?? error.message;
    logger?.error?.(
      `Failed to fetch status for ${assetId}`,
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
