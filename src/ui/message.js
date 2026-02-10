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

function formatMachineLabel(machine, fallbackLabel = "auto") {
  if (!machine) {
    return fallbackLabel;
  }

  if (machine === MACHINE_VALUES.primary) {
    return "imx8";
  }

  if (machine === MACHINE_VALUES.secondary) {
    return "crystal";
  }

  return String(machine);
}

function getServiceLabel(context) {
  return context?.serviceLabel ?? "uplogd";
}

function getGarageDevices(context) {
  if (context?.statusKind !== "garage_mode") {
    return null;
  }
  const statuses = Array.isArray(context?.statuses) ? context.statuses : [];
  const matched = statuses.find(
    (item) => Array.isArray(item?.devices) && item.devices.length > 0
  );
  return matched?.devices ?? null;
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
          success: typeof item?.success === "boolean" ? item.success : null,
          statusCode:
            typeof item?.statusCode === "number" ? item.statusCode : null,
          responseSummary: item?.responseSummary ?? null,
        }))
      : [],
    statuses: Array.isArray(context?.statuses)
      ? context.statuses.map((item) => ({
          assetId: item?.assetId ?? null,
          machine: item?.machine ?? null,
          success: typeof item?.success === "boolean" ? item.success : null,
          statusCode:
            typeof item?.statusCode === "number" ? item.statusCode : null,
          responseSummary: item?.responseSummary ?? null,
          checkedAt: item?.checkedAt ?? null,
        }))
      : [],
    pendingStatusCheck: Boolean(context?.pendingStatusCheck),
    pendingRequest: Boolean(context?.pendingRequest),
    serviceLabel: context?.serviceLabel ?? null,
    statusKind: context?.statusKind ?? null,
    machineLabel: context?.machineLabel ?? null,
    requestedBy: context?.requestedBy
      ? {
          id: context.requestedBy.id ?? null,
          username: context.requestedBy.username ?? null,
          realName: context.requestedBy.realName ?? null,
        }
      : { id: null, username: null, realName: null },
    responseMode:
      context?.responseMode === "ephemeral" ? "ephemeral" : "update",
  };
}

function getRequestedByLabel(requestedBy) {
  if (requestedBy?.id) {
    return `<@${requestedBy.id}>`;
  }

  return "Someone";
}

function buildSummaryParts(context) {
  const actionLabel = formatOperation(context.operation);
  const assetLabel =
    context.baseAsset?.label ?? context.baseAsset?.id ?? "Unknown asset";
  const assetLabelUpper = String(assetLabel).toUpperCase();
  const operationKeyword =
    getOperationKeyword(context.operation) || actionLabel.toLowerCase();
  const requestedByLabel = getRequestedByLabel(context.requestedBy);
  const serviceLabel = getServiceLabel(context);
  const summaryLine =
    context?.summaryLine ??
    `${requestedByLabel} sent a ${operationKeyword} ${serviceLabel} request for *${assetLabelUpper}*`;

  return {
    actionLabel,
    assetLabel,
    assetLabelUpper,
    assetLabelPlain: String(assetLabel),
    operationKeyword,
    requestedByLabel,
    serviceLabel,
    summaryLine,
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
  const {
    actionLabel,
    assetLabelUpper,
    operationKeyword,
    requestedByLabel,
    serviceLabel,
    summaryLine,
  } = buildSummaryParts(context);
  const machineLabelFallback = context?.machineLabel ?? "auto";
  const isGarageStatusOnly =
    context?.statusKind === "garage_mode" && context?.operation === "status";

  const requestFields =
    !isGarageStatusOnly &&
    Array.isArray(context.results) &&
    context.results.length > 0
      ? context.results.map(({ machine, success }) => {
          const machineLabel = formatMachineLabel(machine, machineLabelFallback);
          const outcome =
            success === true
              ? "succeeded"
              : success === false
              ? "failed"
              : "in progress";
          return {
            type: "mrkdwn",
            text: `*${machineLabel}* ${operationKeyword} ${serviceLabel} ${outcome}`,
          };
        })
      : [];

  const garageDevices = getGarageDevices(context);
  const statusFields = garageDevices
    ? garageDevices.map((device) => {
        const label = device.device ?? "device";
        const summary = device.state ?? "unknown";
        const notes = device.notes ? ` (${device.notes})` : "";
        return {
          type: "mrkdwn",
          text: `*${label}* ${summary}${notes}`,
        };
      })
    : Array.isArray(context.statuses) && context.statuses.length > 0
    ? context.statuses.map(({ machine, responseSummary, success }) => {
        const machineLabel = formatMachineLabel(machine, machineLabelFallback);
        const summary = responseSummary ?? (success ? "success" : "failed");
        return {
          type: "mrkdwn",
          text: `*${machineLabel}* ${summary}`,
        };
      })
    : [];

  const previewTimestamp = formatPreviewTimestamp(context.submittedAt);
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: assetLabelUpper },
    },
    { type: "divider" },
  ];

  if (!isGarageStatusOnly) {
    blocks.push(
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
      { type: "divider" }
    );
  }

  if (context.pendingRequest) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:hourglass_flowing_sand: Request sent. Waiting for ${serviceLabel} to confirm the request…`,
      },
    });
    blocks.push({ type: "divider" });
  }

  if (!context.pendingRequest) {
    const isPendingStatus = Boolean(context.pendingStatusCheck);
    const buttonContext = {
      ...context,
      pendingStatusCheck: isPendingStatus,
    };
    blocks.push({
      type: "actions",
      block_id: "uplogd_status_actions",
      elements: [
        {
          type: "button",
          action_id: ACTION_IDS.statusCheck,
          style: "primary",
          text: {
            type: "plain_text",
            text: isPendingStatus
              ? ":hourglass_flowing_sand: Checking status…"
              : "Check status",
          },
          value: encodeButtonValue(buttonContext),
        },
      ],
    });

    if (!isPendingStatus && statusFields.length > 0) {
      const lastStatusTimestampRaw = context.statuses?.[0]?.checkedAt ?? null;
      const lastStatusTimestamp = lastStatusTimestampRaw
        ? formatPreviewTimestamp(lastStatusTimestampRaw)
        : previewTimestamp;

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Last status check | ${lastStatusTimestamp}:*`,
        },
      });
      blocks.push({
        type: "section",
        fields: statusFields,
      });
    }
  }


  return {
    text: `${requestedByLabel} sent a ${operationKeyword} ${serviceLabel} request for ${assetLabelUpper}`,
    blocks,
  };
}

export function createSubmissionContext(submission) {
  const baseAsset =
    submission?.baseAsset && typeof submission.baseAsset === "object"
      ? submission.baseAsset
      : {
          id: submission?.baseAsset ?? null,
          label: submission?.baseAsset ?? null,
        };

  const results = Array.isArray(submission?.results)
    ? submission.results.map((item) => ({
        assetId: item?.assetId ?? baseAsset?.id ?? "unknown",
        machine: item?.machine ?? null,
        success: typeof item?.success === "boolean" ? item.success : null,
        statusCode:
          typeof item?.statusCode === "number" ? item.statusCode : null,
        responseSummary: item?.responseSummary ?? null,
      }))
    : [];

  const statuses = Array.isArray(submission?.statuses)
    ? submission.statuses.map((item) => ({
        assetId: item?.assetId ?? baseAsset?.id ?? "unknown",
        machine: item?.machine ?? null,
        success: typeof item?.success === "boolean" ? item.success : null,
        statusCode:
          typeof item?.statusCode === "number" ? item.statusCode : null,
        responseSummary: item?.responseSummary ?? null,
        checkedAt: item?.checkedAt ?? null,
        devices: Array.isArray(item?.devices) ? item.devices : undefined,
      }))
    : [];

  const requestedBy = submission?.requestedBy
    ? {
        id: submission.requestedBy.id ?? null,
        username: submission.requestedBy.username ?? null,
        realName: submission.requestedBy.realName ?? null,
      }
    : { id: null, username: null, realName: null };

  return {
    baseAsset: {
      id: baseAsset?.id ?? null,
      label: baseAsset?.label ?? baseAsset?.id ?? "Unknown",
    },
    operation: submission?.operation ?? null,
    submittedAt: submission?.submittedAt ?? new Date().toISOString(),
    results,
    statuses,
    pendingStatusCheck: Boolean(submission?.pendingStatusCheck),
    pendingRequest: Boolean(submission?.pendingRequest),
    serviceLabel: submission?.serviceLabel ?? null,
    statusKind: submission?.statusKind ?? null,
    machineLabel: submission?.machineLabel ?? null,
    summaryLine: submission?.summaryLine ?? null,
    requestedBy,
    responseMode:
      submission?.responseMode === "ephemeral" ? "ephemeral" : "update",
  };
}

function buildChannelButtonBlock(context) {
  const buttonContext = {
    ...context,
    pendingRequest: false,
    statuses: Array.isArray(context?.statuses) ? context.statuses : [],
    responseMode: "ephemeral",
  };
  const isPending = Boolean(context?.pendingStatusCheck);

  return {
    type: "actions",
    block_id: "uplogd_status_actions",
    elements: [
      {
        type: "button",
        action_id: ACTION_IDS.statusCheck,
        style: "primary",
        text: {
          type: "plain_text",
          text: isPending
            ? ":hourglass_flowing_sand: Checking status…"
            : "Check status",
        },
        value: encodeButtonValue({
          ...buttonContext,
          pendingStatusCheck: isPending,
        }),
      },
    ],
  };
}

export function buildChannelSummaryMessage(context) {
  const summaryContext = {
    ...context,
    pendingRequest: false,
    responseMode: "ephemeral",
  };
  const { operationKeyword, requestedByLabel, assetLabelPlain } =
    buildSummaryParts(summaryContext);
  const serviceLabel = getServiceLabel(summaryContext);
  const summaryLine =
    summaryContext?.summaryLine ??
    `${requestedByLabel} sent a \`${operationKeyword} ${serviceLabel}\` request for \`${assetLabelPlain}\``;

  return {
    text: summaryLine,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: summaryLine,
        },
      },
      buildChannelButtonBlock(summaryContext),
    ],
  };
}

export function buildStatusOnlyMessage(context) {
  const assetLabel =
    context.baseAsset?.label ?? context.baseAsset?.id ?? "Unknown asset";
  const assetLabelUpper = String(assetLabel).toUpperCase();
  const machineLabelFallback = context?.machineLabel ?? "auto";
  const garageDevices = getGarageDevices(context);

  const statusFields = garageDevices
    ? garageDevices.map((device) => {
        const label = device.device ?? "device";
        const summary = device.state ?? "unknown";
        const notes = device.notes ? ` (${device.notes})` : "";
        return {
          type: "mrkdwn",
          text: `*${label}* ${summary}${notes}`,
        };
      })
    : Array.isArray(context.statuses) && context.statuses.length > 0
    ? context.statuses.map(({ machine, responseSummary, success }) => {
        const machineLabel = formatMachineLabel(machine, machineLabelFallback);
        const summary = responseSummary ?? (success ? "success" : "failed");
        return {
          type: "mrkdwn",
          text: `*${machineLabel}* ${summary}`,
        };
      })
    : [];

  return {
    text: `Latest status for ${assetLabelUpper}`,
    blocks:
      statusFields.length > 0
        ? [
            {
              type: "section",
              fields: statusFields,
            },
          ]
        : [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "_No status results yet._",
              },
            },
          ],
  };
}
