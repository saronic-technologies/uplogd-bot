export function formatPreviewTimestamp(value) {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  const rawHours = date.getHours();
  const hours12 = rawHours % 12 === 0 ? 12 : rawHours % 12;
  const hoursStr = String(hours12).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const suffix = rawHours >= 12 ? "PM" : "AM";

  return `${month}-${day}-${year} ${hoursStr}:${minutes} ${suffix}`;
}
