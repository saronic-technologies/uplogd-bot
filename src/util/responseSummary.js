export function summarizeResponseData(data) {
  if (data === null || data === undefined) {
    return null;
  }

  if (typeof data === "string") {
    return data.length > 200 ? `${data.slice(0, 197)}...` : data;
  }

  if (typeof data === "object") {
    const primary =
      data.message || data.status || data.detail || data.description;

    if (primary && typeof primary === "string") {
      return primary.length > 200 ? `${primary.slice(0, 197)}...` : primary;
    }

    try {
      const serialized = JSON.stringify(data);
      return serialized.length > 200
        ? `${serialized.slice(0, 197)}...`
        : serialized;
    } catch (error) {
      return "[object]";
    }
  }

  const stringified = String(data);
  return stringified.length > 200
    ? `${stringified.slice(0, 197)}...`
    : stringified;
}
