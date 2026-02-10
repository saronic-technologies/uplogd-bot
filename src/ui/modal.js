export const MODAL_CALLBACK_ID = "uplogd-modal";
export const GARAGE_MODE_MODAL_CALLBACK_ID = "garage-mode-modal";

export const BLOCK_IDS = {
  asset: "asset_block",
  machines: "machines_block",
  operation: "operation_block",
};

export const ACTION_IDS = {
  asset: "asset_select",
  machines: "machines_checkbox",
  operation: "operation_radio",
  statusCheck: "status_check_button",
};

export const MACHINE_VALUES = {
  primary: "imx8",
  secondary: "crystal",
};

export const NO_ASSET_VALUE = "__no_asset__";

export function buildErrorModal(message, title = "Manage Uplogd") {
  return {
    type: "modal",
    title: {
      type: "plain_text",
      text: title,
    },
    close: {
      type: "plain_text",
      text: "Close",
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:warning: ${message}`,
        },
      },
    ],
  };
}

function buildAssetOption(asset) {
  if (!asset || !asset.name) {
    return null;
  }

  const value = String(asset.name).slice(0, 75);

  return {
    text: { type: "plain_text", text: value, emoji: true },
    value,
  };
}

function buildAssetOptions(assets) {
  const options = (assets || []).map(buildAssetOption).filter(Boolean);

  if (options.length === 0) {
    options.push({
      text: { type: "plain_text", text: "No assets available", emoji: true },
      value: NO_ASSET_VALUE,
    });
  }

  return options;
}

function buildMachineBlocks({
  primaryAvailable,
  secondaryAvailable,
  selectedValues,
}) {
  const blocks = [{ type: "divider" }];
  const options = [];

  if (primaryAvailable) {
    options.push({
      text: { type: "plain_text", text: "imx8", emoji: true },
      value: MACHINE_VALUES.primary,
    });
  }

  if (secondaryAvailable) {
    options.push({
      text: { type: "plain_text", text: "crystal", emoji: true },
      value: MACHINE_VALUES.secondary,
    });
  }

  const filteredSelections = selectedValues.filter((value) =>
    options.some((option) => option.value === value)
  );
  const initialOptions =
    filteredSelections.length > 0
      ? options.filter((option) => filteredSelections.includes(option.value))
      : options;

  if (options.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Which Machine?*\n_Not available for this asset._",
      },
    });
  } else {
    blocks.push({
      type: "input",
      block_id: BLOCK_IDS.machines,
      optional: false,
      label: {
        type: "plain_text",
        text: "Which Machine?",
      },
      element: {
        type: "checkboxes",
        action_id: ACTION_IDS.machines,
        options,
        initial_options:
          initialOptions.length > 0 ? initialOptions : undefined,
      },
    });
  }

  let noteText = null;

  if (!primaryAvailable && !secondaryAvailable) {
    noteText = "crystal / imx8 not available for this asset.";
  } else if (!primaryAvailable) {
    noteText = "imx8 not available for this asset.";
  } else if (!secondaryAvailable) {
    noteText = "crystal not available for this asset.";
  }

  if (noteText) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: noteText,
        },
      ],
    });
  }

  blocks.push({ type: "divider" });
  return blocks;
}

function buildOperationBlock(selectedOperation) {
  return {
    type: "input",
    block_id: BLOCK_IDS.operation,
    label: {
      type: "plain_text",
      text: "What would you like to do?",
    },
    element: {
      type: "radio_buttons",
      action_id: ACTION_IDS.operation,
      initial_option: selectedOperation
        ? {
            text: {
              type: "plain_text",
              text: selectedOperation.label,
              emoji: true,
            },
            value: selectedOperation.value,
          }
        : undefined,
      options: [
        {
          text: { type: "plain_text", text: "Start", emoji: true },
          value: "start",
        },
        {
          text: { type: "plain_text", text: "Stop", emoji: true },
          value: "stop",
        },
        {
          text: { type: "plain_text", text: "Restart", emoji: true },
          value: "restart",
        },
      ],
    },
  };
}

function buildGarageModeOperationBlock(selectedOperation) {
  return {
    type: "input",
    block_id: BLOCK_IDS.operation,
    label: {
      type: "plain_text",
      text: "Garage Mode Action",
    },
    element: {
      type: "radio_buttons",
      action_id: ACTION_IDS.operation,
      initial_option: selectedOperation
        ? {
            text: {
              type: "plain_text",
              text: selectedOperation.label,
              emoji: true,
            },
            value: selectedOperation.value,
          }
        : undefined,
      options: [
        {
          text: { type: "plain_text", text: "Enter Garage Mode", emoji: true },
          value: "enter",
        },
        {
          text: { type: "plain_text", text: "Exit Garage Mode", emoji: true },
          value: "exit",
        },
        {
          text: { type: "plain_text", text: "Status Check", emoji: true },
          value: "status",
        },
      ],
    },
  };
}

function getSelectedOperation(viewState) {
  const selected =
    viewState?.values?.[BLOCK_IDS.operation]?.[ACTION_IDS.operation]
      ?.selected_option;

  if (selected) {
    return {
      label: selected.text?.text ?? selected.value,
      value: selected.value,
    };
  }

  return null;
}

function getSelectedMachineValues(viewState) {
  return (
    viewState?.values?.[BLOCK_IDS.machines]?.[
      ACTION_IDS.machines
    ]?.selected_options?.map((option) => option.value) ?? []
  );
}

export function buildSubmissionModal({
  userId,
  assets,
  selectedAssetId,
  viewState,
}) {
  const assetOptions = buildAssetOptions(assets);
  const assetUnavailable = (assets?.length ?? 0) === 0;
  const selectedAsset =
    selectedAssetId && assets
      ? assets.find((item) => item.name === selectedAssetId)
      : assets?.[0];

  const initialAssetOption =
    selectedAsset && selectedAsset.name
      ? {
          text: { type: "plain_text", text: selectedAsset.name, emoji: true },
          value: selectedAsset.name,
        }
      : undefined;

  const selectedOperation = getSelectedOperation(viewState);
  const selectedMachines = getSelectedMachineValues(viewState);
  const machineBlocks = buildMachineBlocks({
    primaryAvailable: Boolean(selectedAsset?.primary),
    secondaryAvailable: Boolean(selectedAsset?.secondary),
    selectedValues: selectedMachines,
  });

  return {
    type: "modal",
    callback_id: MODAL_CALLBACK_ID,
    title: {
      type: "plain_text",
      text: "Manage Uplogd",
    },
    submit: {
      type: "plain_text",
      text: "Submit",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    private_metadata: JSON.stringify({
      openedBy: userId,
      selectedAssetId: selectedAsset?.name ?? null,
    }),
    blocks: [
      {
        type: "input",
        block_id: BLOCK_IDS.asset,
        optional: assetUnavailable,
        dispatch_action: true,
        label: {
          type: "plain_text",
          text: "Asset",
        },
        element: {
          type: "static_select",
          action_id: ACTION_IDS.asset,
          placeholder: {
            type: "plain_text",
            text: assetUnavailable ? "No assets available" : "Select an asset",
          },
          initial_option: initialAssetOption,
          options: assetOptions,
        },
      },
      ...machineBlocks,
      buildOperationBlock(selectedOperation),
    ].filter(Boolean),
  };
}

export function buildGarageModeModal({
  userId,
  assets,
  selectedAssetId,
  viewState,
}) {
  const assetOptions = buildAssetOptions(assets);
  const assetUnavailable = (assets?.length ?? 0) === 0;
  const selectedAsset =
    selectedAssetId && assets
      ? assets.find((item) => item.name === selectedAssetId)
      : assets?.[0];

  const initialAssetOption =
    selectedAsset && selectedAsset.name
      ? {
          text: { type: "plain_text", text: selectedAsset.name, emoji: true },
          value: selectedAsset.name,
        }
      : undefined;

  const selectedOperation = getSelectedOperation(viewState);

  return {
    type: "modal",
    callback_id: GARAGE_MODE_MODAL_CALLBACK_ID,
    title: {
      type: "plain_text",
      text: "Garage Mode",
    },
    submit: {
      type: "plain_text",
      text: "Submit",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    private_metadata: JSON.stringify({
      openedBy: userId,
      selectedAssetId: selectedAsset?.name ?? null,
    }),
    blocks: [
      {
        type: "input",
        block_id: BLOCK_IDS.asset,
        optional: assetUnavailable,
        dispatch_action: true,
        label: {
          type: "plain_text",
          text: "Asset",
        },
        element: {
          type: "static_select",
          action_id: ACTION_IDS.asset,
          placeholder: {
            type: "plain_text",
            text: assetUnavailable ? "No assets available" : "Select an asset",
          },
          initial_option: initialAssetOption,
          options: assetOptions,
        },
      },
      buildGarageModeOperationBlock(selectedOperation),
    ].filter(Boolean),
  };
}
