# Uplogd Slack Bot

Slack app scaffold that runs entirely in Socket Mode, opens a modal from a global shortcut, and forwards the submission to an external HTTP endpoint.

## Prerequisites

- Node.js 18+
- Slack workspace where you can create/manage apps
- External API endpoint that accepts JSON POST requests

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and populate the values:

   ```bash
   cp .env.example .env
   ```

   | Variable | Description |
   | --- | --- |
   | `SLACK_SIGNING_SECRET` | **Required.** Found on your app's **Basic Information** page. |
   | `SLACK_BOT_TOKEN` | **Required.** Bot token with `commands` and `chat:write` scopes. |
   | `SLACK_APP_TOKEN` | **Required.** App-level token with the `connections:write` scope for Socket Mode. |
   | `API_ENDPOINT` | **Required.** URL that receives the form data. |
   | `API_AUTH_TOKEN` | Optional bearer token added to the outbound request. |
   | `SHORTCUT_CALLBACK_ID` | Optional. Defaults to `manage_uplogd`. Must match your global shortcut callback ID. |
   | `ASSETS_ENDPOINT` | **Required.** URL returning a list of assets used to populate the modal dropdown. |
   | `ASSETS_AUTH_TOKEN` | Optional bearer token used when fetching assets. |

3. Create the Slack app (or open your existing one):

   - Enable **Socket Mode** and generate an app-level token with the `connections:write` scope.
   - Enable **Interactivity & Shortcuts** (no public URL needed when using Socket Mode).
   - Add a **Global Shortcut** whose callback ID matches `SHORTCUT_CALLBACK_ID` (default `manage_uplogd`).
   - Add the following bot scopes: `commands`, `chat:write`, and any additional scopes you need.
   - Install the app to your workspace and copy the credentials into your `.env` file.

## Running locally

```bash
npm run dev
```

This starts the Bolt app in Socket Mode—no public URL or tunneling tool is required.

## How it works

- The global shortcut fires `src/app.js`, which fetches assets from `ASSETS_ENDPOINT`, then opens the modal defined in `src/modal.js`.
- When the user submits the modal, `src/services/submitForm.js` serializes the selected asset, which targets (`imx8`/`crystal`) were checked, and the chosen action (`start`, `stop`, `restart`), then sends them to `API_ENDPOINT` via `axios`.
- A bearer token header is added when `API_AUTH_TOKEN` is provided.

You can extend the modal blocks or adjust the payload transformation inside `submitFormPayload` to match your API contract.

### Asset endpoint contract

`ASSETS_ENDPOINT` should respond with either:

- An array of strings; each string becomes both the option label and value.
- An array of objects containing at least an identifier (`asset`, `id`, `uuid`, `slug`, `code`, or `key`) and a display name (`name`, `title`, `label`, or `display_name`). Optional `description` fields are truncated and shown as helper text in the select menu.

If the endpoint responds with an object, the adapter falls back to `data.items`.

The dropdown currently filters assets to those whose name starts with `sg`, `by`, or `cr`. Primary/secondary flags from the payload determine which options appear under the "Which Machine?" checkbox group (`imx8` for primary, `crystal` for secondary), and unavailable machines are noted inline. The selected action (`start`, `stop`, `restart`) and any checked targets are included in the submission payload, and each selected machine results in a POST to `API_ENDPOINT/uplog/{boat}/{action}` (with `boat` taken from the asset ID) carrying the machine and metadata.
