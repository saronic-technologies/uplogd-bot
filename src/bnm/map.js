import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULT_AOI, DEFAULT_BASEMAP, DEFAULT_MAP_VIEW } from "./config.js";

const execFileAsync = promisify(execFile);
const GROUPED_LABEL_OFFSET_Y = 14;
const GROUPED_LABEL_LINE_HEIGHT = 14;
const TITLE_COLOR = "rgb(22, 32, 41)";

function formatTitleDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });

  return formatter
    .formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => part.value.toUpperCase())
    .join(" ");
}

function projectPoint([lon, lat], extent, frame) {
  const x =
    frame.x +
    ((lon - extent.minLon) / (extent.maxLon - extent.minLon || 1)) *
      frame.width;
  const y =
    frame.y +
    frame.height -
    ((lat - extent.minLat) / (extent.maxLat - extent.minLat || 1)) *
      frame.height;
  return [x, y];
}

function polygonToSvgPath(points, extent, frame) {
  const projected = points.map((point) => projectPoint(point, extent, frame));

  return projected
    .map(
      ([x, y], index) =>
        `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`,
    )
    .join(" ");
}

const NOTICE_STYLE_PALETTE = {
  la_jolla_dive: {
    label: "DIVING OPS - La Jolla",
    fill: "#2563EB",
    stroke: "#1D4ED8",
  },
  coronado_dive: {
    label: "DIVING OPS - Coronado",
    fill: "#0EA5E9",
    stroke: "#0369A1",
  },
  pyramid_cove_buoys: {
    label: "ATON - Pyramid Cove Buoys",
    fill: "#EAB308",
    stroke: "#A16207",
  },
  offshore_haz_west: {
    label: "HAZ OPS - Offshore West",
    fill: "#DC2626",
    stroke: "#991B1B",
  },
  offshore_haz_central: {
    label: "HAZ OPS - Offshore Central",
    fill: "#F97316",
    stroke: "#C2410C",
  },
  offshore_haz_north: {
    label: "HAZ OPS - Offshore North",
    fill: "#FB7185",
    stroke: "#BE123C",
  },
  haz_ops_pyramid_cove: {
    label: "HAZ OPS - Pyramid Cove",
    fill: "#F59E0B",
    stroke: "#B45309",
  },
  haz_ops_coronado: {
    label: "HAZ OPS - Coronado",
    fill: "#EF4444",
    stroke: "#B91C1C",
  },
  diving_ops_other: {
    label: "DIVING OPS - Other",
    fill: "#3B82F6",
    stroke: "#1D4ED8",
  },
  military_ops: {
    label: "MILITARY OPS",
    fill: "#14B8A6",
    stroke: "#0F766E",
  },
  navy_ops: {
    label: "NAVY OPS",
    fill: "#10B981",
    stroke: "#047857",
  },
  other_notice: {
    label: "OTHER NOTICE",
    fill: "#64748B",
    stroke: "#334155",
  },
};

function getGeometryCentroid(geometry) {
  const points = geometry?.coordinates?.[0];
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }

  const valid = points.slice(0, points.length > 1 ? -1 : points.length);
  if (valid.length === 0) {
    return null;
  }

  const lon = valid.reduce((sum, [value]) => sum + value, 0) / valid.length;
  const lat = valid.reduce((sum, [, value]) => sum + value, 0) / valid.length;
  return { lon, lat };
}

function getGeometryBottomAnchor(geometry) {
  const points = geometry?.coordinates?.[0];
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }

  const valid = points.slice(0, points.length > 1 ? -1 : points.length);
  if (valid.length === 0) {
    return null;
  }

  let anchor = valid[0];
  let minLat = valid[0][1];
  let lonSum = 0;
  let count = 0;

  valid.forEach((point) => {
    const [lon, lat] = point;
    if (lat < minLat) {
      minLat = lat;
      anchor = point;
    }
  });

  valid.forEach((point) => {
    const [lon, lat] = point;
    if (Math.abs(lat - minLat) < 0.0001) {
      lonSum += lon;
      count += 1;
    }
  });

  return {
    lon: count > 0 ? lonSum / count : anchor[0],
    lat: minLat,
  };
}

function buildUntilLabel(notice) {
  const until = notice?.relevance?.until_local;
  if (!until) {
    return null;
  }
  return `${notice.notice_id} Until ${until}`;
}

function clusterLabelAnchors(items, distanceThreshold = 48) {
  const clusters = [];

  items.forEach((item) => {
    const cluster = clusters.find((candidate) => {
      const dx = candidate.x - item.x;
      const dy = candidate.y - item.y;
      return Math.sqrt(dx * dx + dy * dy) <= distanceThreshold;
    });

    if (cluster) {
      cluster.items.push(item);
      cluster.x =
        cluster.items.reduce((sum, current) => sum + current.x, 0) /
        cluster.items.length;
      cluster.y = Math.max(...cluster.items.map((current) => current.y));
      return;
    }

    clusters.push({
      x: item.x,
      y: item.y,
      items: [item],
    });
  });

  return clusters;
}

function renderGroupedLabels(notices, projectionExtent, imageFrame) {
  const labelItems = notices
    .map((notice) => {
      const bottomAnchor = getGeometryBottomAnchor(notice.geometry);
      const untilText = buildUntilLabel(notice);
      if (!bottomAnchor || !untilText) {
        return null;
      }

      const [x, y] = projectPoint(
        [bottomAnchor.lon, bottomAnchor.lat],
        projectionExtent,
        imageFrame,
      );

      return {
        x,
        y,
        text: untilText,
        color: getNoticeStyle(notice).stroke,
      };
    })
    .filter(Boolean);

  const clusters = clusterLabelAnchors(labelItems);

  return clusters
    .map((cluster) => {
      const lines = cluster.items.map((item) => item.text);
      const color = cluster.items[0]?.color ?? "#334155";
      const x = cluster.x;
      const startY = Math.min(
        cluster.y + GROUPED_LABEL_OFFSET_Y,
        imageFrame.y + imageFrame.height - 8,
      );

      return lines
        .map(
          (line, index) => `
            <text x="${x.toFixed(1)}" y="${(
              startY +
              index * GROUPED_LABEL_LINE_HEIGHT
            ).toFixed(
              1,
            )}" font-size="12" text-anchor="middle" dominant-baseline="hanging" font-family="Helvetica" font-weight="600" fill="${color}">${line}</text>
          `,
        )
        .join("\n");
    })
    .join("\n");
}

function getNoticeStyle(notice) {
  const haystack = `${notice.region ?? ""} ${notice.category ?? ""} ${
    notice.instructions?.join(" ") ?? ""
  } ${notice.raw_body ?? ""}`.toUpperCase();
  const category = `${notice.category ?? ""}`.toUpperCase();
  const region = `${notice.region ?? ""}`.toUpperCase();

  if (category.includes("ATON")) {
    return NOTICE_STYLE_PALETTE.pyramid_cove_buoys;
  }

  if (category.includes("DIVING OPS") || category.includes("DIVE")) {
    if (
      haystack.includes("LA JOLLA") ||
      haystack.includes("UNDERSEA RESCUE COMMAND")
    ) {
      return NOTICE_STYLE_PALETTE.la_jolla_dive;
    }

    if (haystack.includes("CORONADO")) {
      return NOTICE_STYLE_PALETTE.coronado_dive;
    }

    return NOTICE_STYLE_PALETTE.diving_ops_other;
  }

  if (haystack.includes("MILITARY") || haystack.includes("FIRING")) {
    return NOTICE_STYLE_PALETTE.military_ops;
  }

  if (haystack.includes("NAVY")) {
    return NOTICE_STYLE_PALETTE.navy_ops;
  }

  if (category.includes("HAZ OPS") || haystack.includes("HAZARDOUS")) {
    if (
      haystack.includes("PYRAMID COVE") ||
      haystack.includes("MOORED BUOYS")
    ) {
      return NOTICE_STYLE_PALETTE.haz_ops_pyramid_cove;
    }

    if (haystack.includes("CORONADO") || region.includes("CORONADO")) {
      return NOTICE_STYLE_PALETTE.haz_ops_coronado;
    }

    const centroid = getGeometryCentroid(notice.geometry);
    if (centroid) {
      if (centroid.lon <= -118.85) {
        return NOTICE_STYLE_PALETTE.offshore_haz_west;
      }
      if (centroid.lat >= 32.95) {
        return NOTICE_STYLE_PALETTE.offshore_haz_north;
      }
      return NOTICE_STYLE_PALETTE.offshore_haz_central;
    }
    return NOTICE_STYLE_PALETTE.offshore_haz_central;
  }

  return NOTICE_STYLE_PALETTE.other_notice;
}

function renderLegend(notices, width, height) {
  const entries = [];
  const seen = new Set();

  notices.forEach((notice) => {
    const style = getNoticeStyle(notice);
    if (!seen.has(style.label)) {
      seen.add(style.label);
      entries.push(style);
    }
  });

  if (entries.length === 0) {
    return "";
  }

  const itemHeight = 34;
  const topInset = 18;
  const bottomInset = 0;
  const legendHeight = topInset + entries.length * itemHeight + bottomInset;
  const legendWidth = 320;
  const x = 40;
  const y = height - legendHeight - 18;

  const rows = entries
    .map((entry, index) => {
      const rowY = y + topInset + index * itemHeight;
      return `
        <rect x="${x + 18}" y="${rowY - 11}" width="16" height="16" fill="${entry.fill}" fill-opacity="0.22" stroke="${entry.stroke}" stroke-width="2" />
        <text x="${x + 48}" y="${rowY + 2}" font-size="16" font-family="Helvetica" fill="#153243">${entry.label}</text>
      `;
    })
    .join("\n");

  return `
    <g>
      <rect x="${x}" y="${y}" width="${legendWidth}" height="${legendHeight}" rx="14" fill="#FFFDF8" fill-opacity="0.92" stroke="#D6D1C4" stroke-width="2" />
      ${rows}
    </g>
  `;
}

function getPngDimensions(buffer) {
  if (!buffer || buffer.length < 24) {
    return null;
  }

  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function fitRect(container, contentWidth, contentHeight) {
  const contentAspect = contentWidth / contentHeight;
  const containerAspect = container.width / container.height;

  if (contentAspect > containerAspect) {
    const width = container.width;
    const height = width / contentAspect;
    return {
      x: container.x,
      y: container.y + (container.height - height) / 2,
      width,
      height,
    };
  }

  const height = container.height;
  const width = height * contentAspect;
  return {
    x: container.x + (container.width - width) / 2,
    y: container.y,
    width,
    height,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeViewExtent(viewExtent, basemapExtent) {
  return {
    minLon: clamp(
      viewExtent.minLon,
      basemapExtent.minLon,
      basemapExtent.maxLon,
    ),
    maxLon: clamp(
      viewExtent.maxLon,
      basemapExtent.minLon,
      basemapExtent.maxLon,
    ),
    minLat: clamp(
      viewExtent.minLat,
      basemapExtent.minLat,
      basemapExtent.maxLat,
    ),
    maxLat: clamp(
      viewExtent.maxLat,
      basemapExtent.minLat,
      basemapExtent.maxLat,
    ),
  };
}

function buildBasemapPlacement({
  imageWidth,
  imageHeight,
  basemapExtent,
  viewExtent,
  containerFrame,
}) {
  const normalizedView = normalizeViewExtent(viewExtent, basemapExtent);
  const lonRange = basemapExtent.maxLon - basemapExtent.minLon || 1;
  const latRange = basemapExtent.maxLat - basemapExtent.minLat || 1;

  const u0 = (normalizedView.minLon - basemapExtent.minLon) / lonRange;
  const u1 = (normalizedView.maxLon - basemapExtent.minLon) / lonRange;
  const v0 = (basemapExtent.maxLat - normalizedView.maxLat) / latRange;
  const v1 = (basemapExtent.maxLat - normalizedView.minLat) / latRange;

  const cropWidthPx = Math.max(1, imageWidth * (u1 - u0));
  const cropHeightPx = Math.max(1, imageHeight * (v1 - v0));
  const frame = fitRect(containerFrame, cropWidthPx, cropHeightPx);
  const placedImageWidth = frame.width / (u1 - u0 || 1);
  const placedImageHeight = frame.height / (v1 - v0 || 1);

  return {
    frame,
    image: {
      x: frame.x - u0 * placedImageWidth,
      y: frame.y - v0 * placedImageHeight,
      width: placedImageWidth,
      height: placedImageHeight,
    },
    viewExtent: normalizedView,
  };
}

async function renderSvg({
  notices,
  aoi = DEFAULT_AOI,
  basemap = DEFAULT_BASEMAP,
  mapView = DEFAULT_MAP_VIEW,
  width = 1200,
  height = 900,
}) {
  const paddingX = 24;
  const topPadding = 24;
  const bottomPadding = 24;
  const contentFrame = {
    x: paddingX,
    y: topPadding,
    width: width - paddingX * 2,
    height: height - topPadding - bottomPadding,
  };
  let basemapImage = "";
  let imageFrame = contentFrame;
  let projectionExtent = mapView?.extent ?? basemap?.extent ?? aoi.extent;

  if (basemap?.path) {
    try {
      const imageBuffer = await fs.readFile(basemap.path);
      const dimensions = getPngDimensions(imageBuffer);
      if (dimensions?.width && dimensions?.height) {
        const placement = buildBasemapPlacement({
          imageWidth: dimensions.width,
          imageHeight: dimensions.height,
          basemapExtent: basemap.extent,
          viewExtent: projectionExtent,
          containerFrame: contentFrame,
        });
        imageFrame = placement.frame;
        projectionExtent = placement.viewExtent;
        const {
          x,
          y,
          width: placedWidth,
          height: placedHeight,
        } = placement.image;
        const encoded = imageBuffer.toString("base64");
        basemapImage = `<image x="${x}" y="${y}" width="${placedWidth}" height="${placedHeight}" href="data:image/png;base64,${encoded}" preserveAspectRatio="none" />`;
      } else {
        const encoded = imageBuffer.toString("base64");
        basemapImage = `<image x="${imageFrame.x}" y="${imageFrame.y}" width="${imageFrame.width}" height="${imageFrame.height}" href="data:image/png;base64,${encoded}" preserveAspectRatio="xMidYMid meet" />`;
      }
    } catch (error) {
      basemapImage = "";
    }
  }

  const noticeElements = notices
    .filter((notice) => notice.geometry?.coordinates?.[0]?.length)
    .map((notice) => {
      const points = notice.geometry.coordinates[0];
      const path = polygonToSvgPath(points, projectionExtent, imageFrame);
      const style = getNoticeStyle(notice);

      return `
        <path d="${path} Z" fill="${style.fill}" fill-opacity="0.20" stroke="${style.stroke}" stroke-width="2" />
      `;
    })
    .join("\n");

  const legend = renderLegend(notices, width, height);
  const groupedLabels = renderGroupedLabels(
    notices.filter((notice) => notice.geometry?.coordinates?.[0]?.length),
    projectionExtent,
    imageFrame,
  );
  const titleDate = formatTitleDate();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#F4F1EA" />
  ${basemapImage}
  <text x="36" y="58" font-size="34" font-weight="700" font-family="Helvetica" fill="${TITLE_COLOR}">NOTMARs - Sector San Diego ${titleDate}</text>
  ${noticeElements}
  ${groupedLabels}
  ${legend}
</svg>`;
}

export async function generateMapImage({
  notices,
  svgPath,
  pngPath,
  aoi = DEFAULT_AOI,
  basemap = DEFAULT_BASEMAP,
}) {
  const svg = await renderSvg({ notices, aoi, basemap });
  await fs.writeFile(svgPath, svg);

  try {
    await execFileAsync("/usr/bin/sips", [
      "-s",
      "format",
      "png",
      svgPath,
      "--out",
      pngPath,
    ]);
    await fs.unlink(svgPath).catch(() => {});
    return pngPath;
  } catch (error) {
    try {
      const outputDir = path.dirname(svgPath);
      await execFileAsync("/usr/bin/qlmanage", [
        "-t",
        "-s",
        "1200",
        "-o",
        outputDir,
        svgPath,
      ]);
      await fs.rename(`${svgPath}.png`, pngPath);
      await fs.unlink(svgPath).catch(() => {});
      return pngPath;
    } catch (fallbackError) {
      return null;
    }
  }
}
