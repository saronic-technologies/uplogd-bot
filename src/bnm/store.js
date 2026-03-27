import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_NOTICE_DIR,
  DEFAULT_RUN_DIR,
  DEFAULT_STORE_DIR,
  DEFAULT_MAP_SVG_PATH,
} from "./config.js";

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

async function writeJson(filePath, payload) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
}

export class StoreManager {
  constructor(rootDir = DEFAULT_STORE_DIR) {
    this.rootDir = rootDir;
    this.noticesDir = path.join(rootDir, DEFAULT_NOTICE_DIR);
    this.runsDir = path.join(rootDir, DEFAULT_RUN_DIR);
    this.mapsDir = path.join(rootDir, DEFAULT_MAP_SVG_PATH);
  }

  async ensureLayout() {
    await Promise.all([
      ensureDir(this.rootDir),
      ensureDir(this.noticesDir),
      ensureDir(this.runsDir),
      ensureDir(this.mapsDir),
    ]);
  }

  latestSummaryPath() {
    return path.join(this.rootDir, "latest_summary.json");
  }

  idIndexPath() {
    return path.join(this.rootDir, "id_to_guid.json");
  }

  rssItemsPath() {
    return path.join(this.rootDir, "seen_rss_items.json");
  }

  noticePath(noticeId) {
    return path.join(this.noticesDir, `${noticeId}.json`);
  }

  runPath(dateKey) {
    return path.join(this.runsDir, `${dateKey}.json`);
  }

  mapPath(dateKey) {
    return path.join(this.mapsDir, `${dateKey}.png`);
  }

  mapSvgPath(dateKey) {
    return path.join(this.mapsDir, `${dateKey}.svg`);
  }

  async loadLatestSummary() {
    return readJson(this.latestSummaryPath(), null);
  }

  async saveLatestSummary(summaryMeta) {
    return writeJson(this.latestSummaryPath(), summaryMeta);
  }

  async loadNotice(noticeId) {
    return readJson(this.noticePath(noticeId), null);
  }

  async saveNotice(noticeId, parsedNotice) {
    return writeJson(this.noticePath(noticeId), parsedNotice);
  }

  async loadIdIndex() {
    return readJson(this.idIndexPath(), {});
  }

  async saveIdIndex(index) {
    return writeJson(this.idIndexPath(), index);
  }

  async loadSeenRssItems() {
    return readJson(this.rssItemsPath(), []);
  }

  async saveSeenRssItems(items) {
    return writeJson(this.rssItemsPath(), items);
  }

  async saveRunOutput(dateKey, payload) {
    return writeJson(this.runPath(dateKey), payload);
  }

  async loadRunOutput(dateKey) {
    return readJson(this.runPath(dateKey), null);
  }
}
