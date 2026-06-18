const SECRET_KEYS = new Set(["authorization", "api-key", "x-api-key", "key"]);

export const createSafeLogEvent = (event) => redactValue(event);

const redactValue = (value) => {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") return typeof value === "string" ? redactSecretString(value) : value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SECRET_KEYS.has(key.toLowerCase()) || key.toLowerCase().includes("apikey") || key.toLowerCase().includes("api_key")
        ? "[redacted]"
        : redactValue(entry),
    ])
  );
};

const redactSecretString = (value) =>
  value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9._-]+/g, "sk-[redacted]")
    .replace(/AIza[A-Za-z0-9._-]+/g, "AIza[redacted]");
