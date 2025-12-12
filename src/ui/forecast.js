const MPH_TO_KTS = 0.868976;
const METERS_TO_FEET = 3.28084;

function formatPacificDate() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
  return formatter.format(new Date());
}

function mphToKts(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }
  return Number(value) * MPH_TO_KTS;
}

function metersToFeet(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }
  return Number(value) * METERS_TO_FEET;
}

function formatRange(values, unit) {
  const [min, max] = values;
  if (min === null && max === null) {
    return "N/A";
  }
  if (min !== null && max !== null) {
    return `${min} - ${max}${unit}`;
  }
  const val = min !== null ? min : max;
  return `${val}${unit}`;
}

function parseWindSpeedToKts(speed) {
  if (!speed) return null;

  const matches = String(speed).match(/([\d.]+)/g);
  if (!matches) return null;

  const numbers = matches.map((num) => Math.round(mphToKts(Number(num))));

  if (numbers.length === 1) {
    return formatRange([numbers[0], null], " kts");
  }

  return formatRange([numbers[0], numbers[1]], " kts");
}

function parseWindSpeedNumbers(speed) {
  if (!speed) return null;
  const matches = String(speed).match(/([\d.]+)/g);
  if (!matches) return null;
  return matches.map((num) => Number(num)).filter((num) => !Number.isNaN(num));
}

function buildWindSpeedKtsString(speed) {
  const numbers = parseWindSpeedNumbers(speed);
  if (!numbers || numbers.length === 0) {
    return null;
  }

  const kts = numbers.map((num) => Math.round(mphToKts(num)));
  if (kts.length === 1) {
    return `${kts[0]} kts`;
  }
  return `${kts[0]} - ${kts[1]} kts`;
}

function directionArrow(direction) {
  const map = {
    N: "⬆️",
    NE: "↗️",
    E: "➡️",
    SE: "↘️",
    S: "⬇️",
    SW: "↙️",
    W: "⬅️",
    NW: "↖️",
  };
  return map[direction?.toUpperCase()] || "";
}

function formatClock(timeStr) {
  if (!timeStr) return "N/A";
  const date = new Date(timeStr.replace(" ", "T"));

  if (Number.isNaN(date.getTime())) {
    return timeStr;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Los_Angeles",
  });

  return formatter.format(date);
}

function degreesToCardinal(degrees) {
  if (
    degrees === null ||
    degrees === undefined ||
    Number.isNaN(Number(degrees))
  ) {
    return null;
  }

  const deg = Number(degrees);
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(deg / 45) % 8;
  return directions[index];
}

function formatDaylightLine(sun) {
  if (!sun?.success || !sun.data) {
    return "Rises @ N/A\nSets @ N/A";
  }

  const sunrise = formatClock(sun.data.sunriseLocal);
  const sunset = formatClock(sun.data.sunsetLocal);
  return `Rises @ ${sunrise}\nSets @ ${sunset}`;
}

function formatTides(tides) {
  if (!tides?.success || !Array.isArray(tides.data)) {
    return { high: "No tide data.", low: "No tide data." };
  }

  const normalizeType = (type) => {
    const upper = String(type || "").toUpperCase();
    if (upper === "H" || upper === "HIGH") return "H";
    if (upper === "L" || upper === "LOW") return "L";
    return null;
  };

  const highs = tides.data
    .filter((entry) => normalizeType(entry.type) === "H")
    .slice(0, 4);
  const lows = tides.data
    .filter((entry) => normalizeType(entry.type) === "L")
    .slice(0, 4);

  const formatEntry = (entry) => {
    const time = formatClock(entry.time);
    const height =
      entry.heightFt !== null && entry.heightFt !== undefined
        ? `${entry.heightFt.toFixed(3)} ft`
        : "N/A";
    return `${time} @ ${height}`;
  };

  const highText =
    highs.length > 0 ? highs.map(formatEntry).join(" \n") : "None";
  const lowText = lows.length > 0 ? lows.map(formatEntry).join(" \n") : "None";

  return { high: highText, low: lowText };
}

function getWaveField(parsed, name) {
  return parsed?.latest?.fields?.find((field) => field.name === name) ?? null;
}

function formatWaves(wave) {
  if (!wave?.success || !wave.parsed) {
    return {
      height: "N/A",
      period: "N/A",
      direction: "N/A",
    };
  }

  const heightField = getWaveField(wave.parsed, "WVHT");
  const periodField = getWaveField(wave.parsed, "DPD");
  const dirField = getWaveField(wave.parsed, "MWD");

  const heightFt = metersToFeet(heightField?.value ?? null);
  const height = heightFt !== null ? `${heightFt.toFixed(1)} ft` : "N/A";
  const period =
    periodField?.value !== null && periodField?.value !== undefined
      ? `${periodField.value} sec`
      : "N/A";
  const directionDeg =
    dirField?.value !== null && dirField?.value !== undefined
      ? `${dirField.value}°`
      : "N/A";
  const cardinal = degreesToCardinal(dirField?.value);
  const dirArrow = directionArrow(cardinal);

  return {
    height,
    period,
    direction: `${directionDeg}${cardinal ? ` ${cardinal}` : ""}${
      dirArrow ? ` ${dirArrow}` : ""
    }`,
  };
}

function buildWeatherSummary(weather) {
  const periods =
    weather?.data?.properties?.periods ||
    weather?.properties?.periods ||
    weather?.data?.periods ||
    [];
  const today = periods?.[0];
  if (!today) {
    return "Weather unavailable.";
  }

  const windKts = buildWindSpeedKtsString(today.windSpeed);
  const windDir = today.windDirection || "";
  const windArrow = directionArrow(windDir);
  const windAppendix =
    windKts || windDir || windArrow
      ? `${windKts ?? ""}${windDir ? ` ${windDir}` : ""}${
          windArrow ? ` ${windArrow}` : ""
        }`.trim()
      : null;

  const summary =
    today.detailedForecast || today.shortForecast || "Weather unavailable.";

  if (windKts && today.windSpeed) {
    const replaced = summary
      .replace(today.windSpeed, windKts)
      .replace(/mph\b/gi, "kts");
    if (replaced !== summary) {
      return replaced;
    }
  }

  if (windAppendix) {
    return `${summary} (${windAppendix})`;
  }

  return summary;
}

function buildTempsField(weather) {
  const periods =
    weather?.data?.properties?.periods ||
    weather?.properties?.periods ||
    weather?.data?.periods ||
    [];
  const today = periods?.[0];
  const tonight = periods?.[1];
  const high =
    today?.temperature !== undefined && today?.temperature !== null
      ? `${today.temperature}° ${today.temperatureUnit || "F"}`
      : "N/A";
  const low =
    tonight?.temperature !== undefined && tonight?.temperature !== null
      ? `${tonight.temperature}° ${tonight.temperatureUnit || "F"}`
      : "N/A";

  return `🌡 *Temps:*\n${high} High\n${low} Low`;
}

function buildWindField(weather) {
  const periods =
    weather?.data?.properties?.periods ||
    weather?.properties?.periods ||
    weather?.data?.periods ||
    [];
  const today = periods?.[0];
  if (!today) {
    return "💨 *Winds:*\nN/A";
  }

  const windKts = parseWindSpeedToKts(today.windSpeed) || "N/A";
  const dir = today.windDirection || "";
  const arrow = directionArrow(dir);

  return `💨 *Winds:*\n${windKts}${dir ? ` ${dir}` : ""}${
    arrow ? ` ${arrow}` : ""
  }`;
}

export function buildForecastMessage({ wave, weather, tides, sun }) {
  const dateLabel = formatPacificDate();
  const weatherSummary = buildWeatherSummary(weather);
  const tempsField = buildTempsField(weather);
  const windField = buildWindField(weather);
  const waves = formatWaves(wave);
  const daylight = formatDaylightLine(sun);
  const tideLines = formatTides(tides);

  return {
    response_type: "in_channel",
    text: "San Diego forecast",
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `San Diego, CA || ${dateLabel}`,
          emoji: true,
        },
      },
      {
        type: "rich_text",
        elements: [
          {
            type: "rich_text_section",
            elements: [
              {
                type: "text",
                text: weatherSummary,
              },
            ],
          },
        ],
      },
      { type: "divider" },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: tempsField },
          { type: "mrkdwn", text: windField },
        ],
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `🌊 *Waves:*\nHeight: ${waves.height}\nPeriod: ${waves.period}\nDirection: ${waves.direction}`,
          },
          {
            type: "mrkdwn",
            text: `☀️ *Daylight:*\n${daylight}`,
          },
        ],
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: "🏝️ *Tides:*",
          },
          {
            type: "mrkdwn",
            text: " ",
          },
          {
            type: "mrkdwn",
            text: `*High:*\n${tideLines.high}`,
          },
          {
            type: "mrkdwn",
            text: `*Low:*\n${tideLines.low}`,
          },
        ],
      },
    ],
  };
}
