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
| `UPLOGD_UPDATES_CHANNEL` | Optional channel ID (e.g. `C01234567`). When set, the bot posts submission updates there instead of DMing the user. |
| `UPLOGD_DM_RECIPIENT` | Optional user ID (e.g. `U0123ABCD`). When set, the bot sends DM summaries to this user instead of the requester. |
| `BNM_STORE_DIR` | Optional. Overrides the local JSON cache directory for the San Diego BNM briefing pipeline. Defaults to `store/`. |
| `BNM_BRIEF_CHANNEL` | Optional channel ID for the daily 7:45 AM Pacific Sector San Diego BNM briefing post. When omitted, the pipeline still runs locally but does not auto-post to Slack. |

3. Create the Slack app (or open your existing one):

   - Enable **Socket Mode** and generate an app-level token with the `connections:write` scope.
   - Enable **Interactivity & Shortcuts** (no public URL needed when using Socket Mode).
   - Add a **Global Shortcut** whose callback ID matches `SHORTCUT_CALLBACK_ID` (default `manage_uplogd`).
   - Add the following bot scopes: `commands`, `chat:write`, and any additional scopes you need. Include `chat:write.public` if you plan to post into public channels the bot hasn't joined yet.
   - Install the app to your workspace and copy the credentials into your `.env` file.

## Running locally

```bash
npm run dev
```

This starts the Bolt app in Socket Mode—no public URL or tunneling tool is required.

## Deploying

The project includes a PM2 script that keeps the bot running on a server:

1. Install dependencies and configure `.env` on the host as described above.
2. Start the background process with:

   ```bash
   npm run deploy
   ```

   This launches PM2 with a process named `uplogd-bot` that watches the `src` directory for changes.

3. Check the process anytime with `pm2 status uplogd-bot`.
4. Stream logs when needed with `pm2 logs uplogd-bot`.
5. Stop or remove the process via `pm2 stop uplogd-bot` or `pm2 delete uplogd-bot`.

## Sector San Diego BNM briefing

The repo now includes a file-backed BNM pipeline that treats the latest Sector San Diego summary as the daily authoritative active set.

- Scheduled run: `7:45 AM America/Los_Angeles`
- Manual run in shell: `npm run bnm:run`
- Manual Slack trigger: `/sdforecast notmar`
- Local artifacts:
  - `store/latest_summary.json`
  - `store/id_to_guid.json`
  - `store/notices/*.json`
  - `store/runs/YYYY-MM-DD.json`
  - `store/maps/YYYY-MM-DD.png`

What the first version does:

- Searches recent NAVCEN Sector San Diego BNM messages
- Finds the latest summary and extracts active notice IDs
- Resolves each active ID to a full notice
- Parses notice timing and polygon coordinate lists
- Filters notices against a built-in San Diego AOI
- Generates a Slack-ready text brief
- Generates a local overlay map PNG when relevant geometry is available

The store is recoverable cache only. If it is deleted, the next run rebuilds state from live NAVCEN data.

## How it works

- The global shortcut fires `src/app.js`, which fetches assets from `ASSETS_ENDPOINT`, then opens the modal defined in `src/modal.js`.
- When the user submits the modal, `src/services/submitForm.js` serializes the selected asset, which targets (`imx8`/`crystal`) were checked, and the chosen action (`start`, `stop`, `restart`), then sends them to `API_ENDPOINT` via `axios`.
- The bot DMs the requester immediately, then edits that DM with the SSH response once the external API call returns. When `UPLOGD_UPDATES_CHANNEL` is set, it also posts a one-line announcement with a status button to that channel; status checks there reply via ephemeral messages so the public post stays clean.
- A bearer token header is added when `API_AUTH_TOKEN` is provided.

You can extend the modal blocks or adjust the payload transformation inside `submitFormPayload` to match your API contract.

### Asset endpoint contract

`ASSETS_ENDPOINT` should respond with either:

- An array of strings; each string becomes both the option label and value.
- An array of objects containing at least an identifier (`asset`, `id`, `uuid`, `slug`, `code`, or `key`) and a display name (`name`, `title`, `label`, or `display_name`). Optional `description` fields are truncated and shown as helper text in the select menu.

If the endpoint responds with an object, the adapter falls back to `data.items`.

The dropdown currently filters assets to those whose name starts with `sg`, `by`, or `cr`. Primary/secondary flags from the payload determine which options appear under the "Which Machine?" checkbox group (`imx8` for primary, `crystal` for secondary), and unavailable machines are noted inline. The selected action (`start`, `stop`, `restart`) and any checked targets are included in the submission payload, and each selected machine results in a POST to `API_ENDPOINT/uplog/{boat}/{action}` (with `boat` taken from the asset ID) carrying the machine and metadata.
