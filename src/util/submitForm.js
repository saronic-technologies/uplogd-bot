import axios from "axios";
import {
  ACTION_IDS,
  BLOCK_IDS,
  MACHINE_VALUES,
  NO_ASSET_VALUE,
} from "../ui/modal.js";
import { fetchAssets } from "./fetchAssets.js";
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

function buildBaseUrl(endpoint, assetId, action) {
  const trimmedEndpoint = endpoint.replace(/\/+$/u, "");
  const boatSegment = sanitizePathSegment(assetId);
  const actionSegment = sanitizePathSegment(action || "noop");
  return `${trimmedEndpoint}/uplogd/${boatSegment}/${actionSegment}`;
}

function extractValues(viewState) {
  const values = viewState?.values ?? {};
  const assetSelection =
    values[BLOCK_IDS.asset]?.[ACTION_IDS.asset]?.selected_option;
  const operationSelection =
    values[BLOCK_IDS.operation]?.[ACTION_IDS.operation]?.selected_option;
  const machineSelections =
    values[BLOCK_IDS.machines]?.[ACTION_IDS.machines]?.selected_options ?? [];

  const selectedMachineValues = new Set(
    machineSelections.map((option) => option.value)
  );

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
    targets: {
      primary: selectedMachineValues.has(MACHINE_VALUES.primary),
      secondary: selectedMachineValues.has(MACHINE_VALUES.secondary),
    },
  };
}

async function enrichAssetMetadata(asset, logger) {
  if (!asset) {
    return null;
  }

  try {
    const assets = await fetchAssets({ logger });
    const match = assets.find((item) => item.name === asset.id);

    if (!match) {
      return asset;
    }

    return {
      ...asset,
      primary: Boolean(match.primary),
      secondary: Boolean(match.secondary),
      lastAuto: match.lastAuto,
      raw: match.raw,
    };
  } catch (error) {
    logger?.error?.("Failed to re-fetch assets during submission", error);
    return asset;
  }
}

function resolveMachineTargets(asset, targets) {
  if (!asset) {
    return [];
  }

  const baseId = asset.id?.replace(/-crystal$/u, "") ?? "";
  const resolvedTargets = [];

  if (targets.primary) {
    resolvedTargets.push({
      assetId: baseId,
      machine: MACHINE_VALUES.primary,
    });
  }

  if (targets.secondary) {
    resolvedTargets.push({
      assetId: `${baseId}-crystal`,
      machine: MACHINE_VALUES.secondary,
    });
  }

  if (resolvedTargets.length === 0) {
    resolvedTargets.push({
      assetId: asset.id,
      machine: null,
    });
  }

  return resolvedTargets.filter(({ assetId }) => Boolean(assetId));
}

export async function submitFormPayload({ user, team, view, logger }) {
  const endpoint = getRequiredEnv("API_ENDPOINT", API_ENDPOINT);
  const headers = {
    "Content-Type": "application/json",
    ...(API_AUTH_TOKEN ? { Authorization: `Bearer ${API_AUTH_TOKEN}` } : {}),
  };

  const { asset, operation, targets } = extractValues(view.state);
  const enrichedAsset = await enrichAssetMetadata(asset, logger);

  if (!enrichedAsset) {
    logger?.warn?.("No asset selected; skipping outbound request.");
    return;
  }

  const privateMetadata = view?.private_metadata
    ? JSON.parse(view.private_metadata)
    : null;
  const submittedAt = new Date().toISOString();
  const machineTargets = resolveMachineTargets(enrichedAsset, targets);

  const baseAssetId = enrichedAsset.id;
  const baseAssetLabel = enrichedAsset.label ?? enrichedAsset.id ?? "unknown";
  const results = await Promise.all(
    machineTargets.map(async ({ assetId, machine }) => {
      const url = buildBaseUrl(endpoint, assetId, operation);
      const payload = {
        asset: {
          ...enrichedAsset,
          id: assetId,
        },
        operation,
        machine,
        targets,
        submittedBy: user?.id,
        teamId: team?.id,
        viewId: view?.id,
        privateMetadata,
        submittedAt,
      };

      try {
        const response = await axios.post(url, payload, {
          headers,
          params: machine ? { machine } : undefined,
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
          `Failed to submit action for ${assetId}`,
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
    })
  );

  return {
    baseAsset: { id: baseAssetId, label: baseAssetLabel },
    operation,
    submittedAt,
    results,
  };
}
