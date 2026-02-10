import axios from "axios";
import { ACTION_IDS, BLOCK_IDS, NO_ASSET_VALUE } from "../ui/modal.js";
import { summarizeResponseData } from "./responseSummary.js";
import { fetchGarageModeStatus } from "./fetchGarageModeStatus.js";

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

function buildBaseUrl(endpoint, assetId) {
  const trimmedEndpoint = endpoint.replace(/\/+$/u, "");
  const assetSegment = sanitizePathSegment(assetId);
  return `${trimmedEndpoint}/garage_mode/${assetSegment}`;
}

function extractValues(viewState) {
  const values = viewState?.values ?? {};
  const assetSelection =
    values[BLOCK_IDS.asset]?.[ACTION_IDS.asset]?.selected_option;
  const operationSelection =
    values[BLOCK_IDS.operation]?.[ACTION_IDS.operation]?.selected_option;

  const assetValue = assetSelection?.value;
  const assetLabel = assetSelection?.text?.text;
  const asset =
    assetValue && assetValue !== NO_ASSET_VALUE
      ? {
          id: assetValue,
          label: assetLabel,
        }
      : null;

  return {
    asset,
    operation: operationSelection?.value ?? null,
  };
}

export async function prepareGarageModeSubmission({ view, logger }) {
  const { asset, operation } = extractValues(view.state);

  if (!asset) {
    logger?.warn?.("No asset selected; skipping garage mode request.");
    return null;
  }

  const privateMetadata = view?.private_metadata
    ? JSON.parse(view.private_metadata)
    : null;
  const submittedAt = new Date().toISOString();

  return {
    asset,
    operation,
    privateMetadata,
    submittedAt,
    baseAsset: { id: asset.id, label: asset.label ?? asset.id ?? "unknown" },
  };
}

export async function submitGarageModePayload({
  user,
  team,
  view,
  logger,
  preparedSubmission,
}) {
  const endpoint = GARAGE_MODE_ENDPOINT;
  const headers = {
    "Content-Type": "application/json",
    ...(API_AUTH_TOKEN ? { Authorization: `Bearer ${API_AUTH_TOKEN}` } : {}),
  };
  const submissionDetails =
    preparedSubmission ?? (await prepareGarageModeSubmission({ view, logger }));

  if (!submissionDetails) {
    return null;
  }

  const { asset, operation, privateMetadata, submittedAt, baseAsset } =
    submissionDetails;

  if (operation === "status") {
    const statusResult = await fetchGarageModeStatus({
      assetId: asset.id,
      machine: null,
      logger,
    });

    return {
      baseAsset,
      operation,
      submittedAt,
      results: [],
      statuses: [statusResult],
      requestedBy: {
        id: user?.id ?? null,
        username: user?.username ?? null,
        realName: user?.name ?? user?.real_name ?? null,
      },
    };
  }

  const url = buildBaseUrl(endpoint, asset.id);
  const payload = {
    action: operation,
    pause_netmand: true,
  };

  try {
    const response = await axios.post(url, payload, { headers });

    return {
      baseAsset,
      operation,
      submittedAt,
      results: [
        {
          assetId: asset.id,
          machine: null,
          success: true,
          statusCode: response.status,
          responseSummary: summarizeResponseData(response.data),
        },
      ],
      requestedBy: {
        id: user?.id ?? null,
        username: user?.username ?? null,
        realName: user?.name ?? user?.real_name ?? null,
      },
    };
  } catch (error) {
    const statusCode = error.response?.status ?? null;
    const responseSummary =
      summarizeResponseData(error.response?.data) ?? error.message;
    logger?.error?.(
      `Failed to submit garage mode action for ${asset.id}`,
      error?.response?.data ?? error
    );

    return {
      baseAsset,
      operation,
      submittedAt,
      results: [
        {
          assetId: asset.id,
          machine: null,
          success: false,
          statusCode,
          responseSummary,
          error: error.message,
        },
      ],
      requestedBy: {
        id: user?.id ?? null,
        username: user?.username ?? null,
        realName: user?.name ?? user?.real_name ?? null,
      },
    };
  }
}
