import "dotenv/config";
import { runDailyBrief } from "./bnm/orchestrator.js";

function log(level, message, meta) {
  const stamp = new Date().toISOString();
  const payload =
    meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  // eslint-disable-next-line no-console
  console[level](`${stamp} [bnm:${level}] ${message}${payload}`);
}

const logger = {
  info(message, meta) {
    log("log", message, meta);
  },
  warn(message, meta) {
    log("warn", message, meta);
  },
  error(message, meta) {
    log("error", message, meta);
  },
};

async function main() {
  const result = await runDailyBrief({
    logger,
    storeDir: process.env.BNM_STORE_DIR,
    forceRefresh: process.env.BNM_FORCE_REFRESH === "1",
  });

  // eslint-disable-next-line no-console
  console.log(result.slackText);
  // eslint-disable-next-line no-console
  console.log(`Run artifact: ${result.runPath}`);
  if (result.mapPath) {
    // eslint-disable-next-line no-console
    console.log(`Map: ${result.mapPath}`);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("BNM brief run failed", error);
  process.exitCode = 1;
});
