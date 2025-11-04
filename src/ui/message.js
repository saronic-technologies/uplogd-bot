import { ACTION_IDS, MACHINE_VALUES } from "./modal.js";
import { formatPreviewTimestamp } from "../util/time.js";

function formatOperation(operation) {
  if (!operation) {
    return "Action";
  }

  const normalized = String(operation).trim().toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getOperationKeyword(operation) {
  if (!operation) {
    return "action";
  }

  return String(operation).toLowerCase();
}

function formatMachineLabel(machine) {
  if (!machine) {
    return "auto";
  }

  if (machine === MACHINE_VALUES.primary) {
    return "imx8";
  }

  if (machine === MACHINE_VALUES.secondary) {
    return "crystal";
  }

  return String(machine);
}

function sanitizeContextForButton(context) {
  return {
    baseAsset: {
      id: context?.baseAsset?.id ?? null,
      label: context?.baseAsset?.label ?? null,
    },
    operation: context?.operation ?? null,
    submittedAt: context?.submittedAt ?? null,
    results: Array.isArray(context?.results)
      ? context.results.map((item) => ({
          assetId: item?.assetId ?? null,
          machine: item?.machine ?? null,
          success: Boolean(item?.success),
          statusCode:
            typeof item?.statusCode === "number" ? item.statusCode : null,
          responseSummary: item?.responseSummary ?? null,
        }))
      : [],
    statuses: Array.isArray(context?.statuses)
      ? context.statuses.map((item) => ({
          assetId: item?.assetId ?? null,
          machine: item?.machine ?? null,
          success: Boolean(item?.success),
          statusCode:
            typeof item?.statusCode === "number" ? item.statusCode : null,
          responseSummary: item?.responseSummary ?? null,
          checkedAt: item?.checkedAt ?? null,
        }))
      : [],
    pendingStatusCheck: Boolean(context?.pendingStatusCheck),
  };
}

function encodeButtonValue(context) {
  try {
    return JSON.stringify(sanitizeContextForButton(context));
  } catch (error) {
    return "{}";
  }
}

export function buildSubmissionMessage(context) {
  const actionLabel = formatOperation(context.operation);
  const assetLabel =
    context.baseAsset?.label ?? context.baseAsset?.id ?? "Unknown asset";
  const assetLabelUpper = String(assetLabel).toUpperCase();
  const operationKeyword = getOperationKeyword(context.operation) || actionLabel.toLowerCase();

  const requestFields =
    Array.isArray(context.results) && context.results.length > 0
      ? context.results.map(({ machine, success }) => {
          const machineLabel = formatMachineLabel(machine);
          const outcome = success ? "success" : "failed";
          return {
            type: "mrkdwn",
            text: `*${machineLabel}*\n${operationKeyword} uplogd ${outcome}`,
          };
        })
      : [];

  const statusFields =
    Array.isArray(context.statuses) && context.statuses.length > 0
      ? context.statuses.map(({ machine, responseSummary, success }) => {
          const machineLabel = formatMachineLabel(machine);
          const summary =
            responseSummary ??
            (success ? "success" : "failed");
          return {
            type: "mrkdwn",
            text: `*${machineLabel}*\n${summary}`,
          };
        })
      : [];

  const previewTimestamp = formatPreviewTimestamp(context.submittedAt);
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${actionLabel}* request sent to *${assetLabelUpper}* at ${previewTimestamp}`,
      },
    },
    { type: "divider" },
    {
      type: "header",
      text: { type: "plain_text", text: assetLabelUpper },
    },
    { type: "divider" },
    requestFields.length > 0
      ? {
          type: "section",
          fields: requestFields,
        }
      : {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "_No requests were sent._",
          },
        },
    { type: "divider" },
  ];

  if (context.pendingStatusCheck) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":large_blue_circle: Checking current status… _up to 1 minute_",
      },
    });
  } else {
    const buttonContext = { ...context, pendingStatusCheck: false };
    blocks.push({
      type: "actions",
      block_id: "uplogd_status_actions",
      elements: [
        {
          type: "button",
          action_id: ACTION_IDS.statusCheck,
          style: "primary",
          text: { type: "plain_text", text: "Check status" },
          value: encodeButtonValue(buttonContext),
        },
      ],
    });
  }

  const lastStatusTimestampRaw = context.statuses?.[0]?.checkedAt ?? null;
  const lastStatusTimestamp = lastStatusTimestampRaw
    ? formatPreviewTimestamp(lastStatusTimestampRaw)
    : null;

  if (statusFields.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Last status check | ${lastStatusTimestamp ?? previewTimestamp}:*`,
      },
    });
    blocks.push({
      type: "section",
      fields: statusFields,
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Last status check:* _No status checks yet._",
      },
    });
  }

  return {
    text: `${actionLabel} request sent to ${assetLabelUpper} at ${previewTimestamp}`,
    blocks,
  };
}

export function createSubmissionContext(submission) {
  const baseAsset =
    submission?.baseAsset && typeof submission.baseAsset === "object"
      ? submission.baseAsset
      : { id: submission?.baseAsset ?? null, label: submission?.baseAsset ?? null };

  const results = Array.isArray(submission?.results)
    ? submission.results.map((item) => ({
        assetId: item?.assetId ?? baseAsset?.id ?? "unknown",
        machine: item?.machine ?? null,
        success: Boolean(item?.success),
        statusCode:
          typeof item?.statusCode === "number" ? item.statusCode : null,
        responseSummary: item?.responseSummary ?? null,
      }))
    : [];

  return {
    baseAsset: {
      id: baseAsset?.id ?? null,
      label: baseAsset?.label ?? baseAsset?.id ?? "Unknown",
    },
    operation: submission?.operation ?? null,
    submittedAt: submission?.submittedAt ?? new Date().toISOString(),
    results,
    statuses: [],
    pendingStatusCheck: false,
  };
}
