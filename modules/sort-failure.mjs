// User-facing failures name the recovery without echoing provider content.
export const sortFailureNotice = (failure, engine) => {
  const reason = String(typeof failure === "string" ? failure : failure?.message || "");
  const labels = { access: "AI key rejected", credits: "AI needs credits", model: "Model not found",
    busy: "AI is busy", configuration: "Check AI setup", size: "Too many tabs", provider: "AI unavailable",
    "output-limit": "AI reply cut short", timeout: "AI took too long", connection: "AI offline",
    blocked: "AI declined", local: "Local AI unavailable", response: "Invalid AI reply", unknown: "Couldn't tidy" };
  const notice = (code, message) => ({ code, message, label: labels[code] });
  if (/\b(?:401|403)\b/.test(reason)) return notice("access", "AI access was rejected. Check the key in AI setup.");
  if (/\b402\b/.test(reason)) return notice("credits", "The AI account needs credits. Check AI setup.");
  if (/\b404\b/.test(reason)) return notice("model", "AI model not found. Choose a model in AI setup.");
  if (/\b429\b/.test(reason)) return notice("busy", "AI is busy. Try again in a moment.");
  if (/\b(?:400|422)\b/.test(reason)) return notice("configuration", "AI rejected the request. Check the model in AI setup.");
  if (/\b413\b/.test(reason)) return notice("size", "This workspace exceeds the AI provider's input limit.");
  if (/\b5\d\d\b/.test(reason)) return notice("provider", "The AI service is unavailable. Try again shortly.");
  if (/output limit|token limit|truncat/i.test(reason)) return notice("output-limit", "AI response was cut short. Try a faster model.");
  if (/timeout|timed out/i.test(reason)) return notice("timeout", "AI took too long. Try again or choose a faster model.");
  if (/network|fetch|connect/i.test(reason)) return notice("connection", "Couldn't reach AI. Check the connection and try again.");
  if (/blocked|refus|safety/i.test(reason)) return notice("blocked", "AI declined these tabs. Try another model.");
  if (engine === "local") return notice("local", "On-device AI is unavailable. Choose an engine in AI setup.");
  if (/JSON|categor|group|assign|response|plan|label/i.test(reason)) return notice("response", "AI returned incomplete groups. Try again.");
  return notice("unknown", "Couldn't tidy these tabs. Try again or check AI setup.");
};
