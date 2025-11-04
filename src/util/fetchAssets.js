import axios from 'axios';

const { ASSETS_ENDPOINT, ASSETS_AUTH_TOKEN } = process.env;
const ASSET_PREFIXES = ['sg', 'by', 'cr'];

function normalizeAssetList(data) {
  if (!data) {
    return [];
  }

  if (Array.isArray(data)) {
    return data;
  }

  const candidates = [
    data.assets,
    data.items,
    data.results,
    data.data,
    data.records,
  ].find(Array.isArray);

  return Array.isArray(candidates) ? candidates : [];
}

function toAssetObject(item) {
  if (!item) {
    return null;
  }

  if (typeof item === 'string') {
    return {
      name: item,
      primary: false,
      secondary: false,
      lastAuto: null,
      raw: item,
    };
  }

  if (typeof item === 'object') {
    const name =
      item.asset ||
      item.name ||
      item.title ||
      item.label ||
      item.display_name ||
      item.slug;

    if (!name) {
      return null;
    }

    return {
      name,
      primary: Boolean(item.primary),
      secondary: Boolean(item.secondary),
      lastAuto: item.last_auto_plt_time || item.lastAuto || null,
      raw: item,
    };
  }

  return null;
}

function matchesPrefix(name) {
  return ASSET_PREFIXES.some((prefix) => name.toLowerCase().startsWith(prefix));
}

function filterAssets(assets, logger) {
  const mapped = assets.map(toAssetObject).filter(Boolean);
  const filtered = mapped.filter((asset) => matchesPrefix(asset.name));

  logger?.debug?.(
    `Filtered assets by prefix (${ASSET_PREFIXES.join(', ')}): ${filtered.length} of ${mapped.length}`
  );

  return filtered.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  );
}

export async function fetchAssets({ logger } = {}) {
  if (!ASSETS_ENDPOINT) {
    logger?.warn?.('ASSETS_ENDPOINT not set; showing empty asset list.');
    return [];
  }

  const headers = {
    ...(ASSETS_AUTH_TOKEN ? { Authorization: `Bearer ${ASSETS_AUTH_TOKEN}` } : {}),
  };

  logger?.debug?.(`Fetching assets from ${ASSETS_ENDPOINT}`);
  const response = await axios.get(ASSETS_ENDPOINT, { headers });
  const normalized = normalizeAssetList(response.data);
  logger?.debug?.(`Fetched ${normalized.length} raw assets.`);
  const filtered = filterAssets(normalized, logger);
  logger?.debug?.(`Returning ${filtered.length} assets after filtering.`);
  return filtered;
}
