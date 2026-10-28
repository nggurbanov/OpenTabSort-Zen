// The everyday settings surface: connect an AI once, then use the wand.
import { CONFIG, h } from "./config.mjs";

const ENGINE_OPTIONS = [
  ["off", "Choose an AI engine"],
  ["openai", "OpenAI-compatible"],
  ["gemini", "Gemini"],
  ["ollama", "Ollama"],
  ["local", "Built-in local AI"],
  ["custom", "Custom endpoint"],
  ["jev", "Decision models"],
];
const fieldsFor = (provider) => ({
  openai: [
    [CONFIG.AI_OPENAI_ENDPOINT_PREF, "Endpoint", "https://api.openai.com/v1"],
    [CONFIG.AI_OPENAI_MODEL_PREF, "Model", "Model ID"],
    [CONFIG.AI_OPENAI_API_KEY_PREF, "API key", "", "password"],
  ],
  gemini: [
    [CONFIG.AI_GEMINI_MODEL_PREF, "Model", "Model ID"],
    [CONFIG.AI_GEMINI_API_KEY_PREF, "API key", "", "password"],
  ],
  ollama: [
    [CONFIG.AI_OLLAMA_HOST_PREF, "Ollama address", "http://localhost:11434", "text", "http://localhost:11434"],
    [CONFIG.AI_OLLAMA_MODEL_PREF, "Model", "qwen2.5:1.5b", "text", "qwen2.5:1.5b"],
  ],
  custom: [
    [CONFIG.AI_CUSTOM_ENDPOINT_PREF, "Endpoint", "https://your-provider.example/v1"],
    [CONFIG.AI_CUSTOM_MODEL_PREF, "Model", "Model ID"],
    [CONFIG.AI_CUSTOM_API_KEY_PREF, "API key (if required)", "", "password"],
  ],
  jev: [
    [CONFIG.AI_JEV_ENDPOINT_PREF, "Decision endpoint", CONFIG.AI_JEV_ENDPOINT_DEFAULT, "text", CONFIG.AI_JEV_ENDPOINT_DEFAULT],
    [CONFIG.AI_JEV_MODEL_PREF, "Decision model", "jev-latest", "text", "jev-latest"],
    [CONFIG.AI_JEV_API_KEY_PREF, "Decision API key", "", "password"],
  ],
}[provider] || []);
const readString = (pref, fallback = "") => Services.prefs.getStringPref(pref, fallback);
const boolPref = (pref, fallback = false) => Services.prefs.getBoolPref(pref, fallback);

export const buildSimpleSettings = ({ onChange = () => {} } = {}) => {
  const root = h("section", { class: "zao-simple-settings" });
  const heading = h("h2", { text: "AI setup" });
  root.append(heading, h("p", { class: "zao-simple-intro",
    text: "Click the wand to organize this workspace. AI creates the groups. Stop and Undo stay available." }));
  const connection = h("div", { class: "zao-simple-connection" });
  const providerFields = h("div", { class: "zao-simple-fields" });
  const engineLabel = h("label", { class: "zao-simple-field" });
  engineLabel.appendChild(h("span", { text: "AI engine" }));
  const engine = h("select", { class: "zao-settings-select zao-simple-engine" });
  engine.dataset.pref = CONFIG.AI_ENGINE_PREF;
  for (const [value, text] of ENGINE_OPTIONS) {
    const option = h("option", { text }); option.value = value; engine.appendChild(option);
  }
  engineLabel.appendChild(engine); connection.append(engineLabel, providerFields); root.appendChild(connection);

  const controls = [];
  const save = (pref, value, checkbox = false) => {
    if (checkbox) Services.prefs.setBoolPref(pref, value);
    else Services.prefs.setStringPref(pref, value);
    onChange();
  };
  const addField = (descriptor, parent = providerFields) => {
    const [pref, text, placeholder = "", type = "text", fallback = ""] = descriptor;
    const label = h("label", { class: "zao-simple-field" });
    label.appendChild(h("span", { text }));
    const input = h("input"); input.type = type; input.placeholder = placeholder;
    input.value = readString(pref, fallback); input.dataset.pref = pref; input.spellcheck = false;
    input.setAttribute("autocomplete", "off");
    input.addEventListener("input", () => save(pref, input.value));
    label.appendChild(input); parent.appendChild(label); controls.push({ input, pref, fallback });
  };
  const checkbox = (pref, text, parent, fallback = false) => {
    const label = h("label", { class: "zao-simple-check" });
    const input = h("input"); input.type = "checkbox"; input.dataset.pref = pref; input.checked = boolPref(pref, fallback);
    input.addEventListener("change", () => save(pref, input.checked, true));
    label.append(input, h("span", { text })); parent.appendChild(label); controls.push({ input, pref, fallback, checkbox: true });
  };
  let renderedEngine, renderedCategoryProvider;
  const renderConnection = (value) => {
    renderedEngine = value; providerFields.replaceChildren(); controls.length = 0;
    for (const descriptor of fieldsFor(value)) addField(descriptor);
    if (value === "ollama") providerFields.appendChild(h("p", { class: "zao-simple-help", text: "Runs on your machine. The model loads when needed and uses local RAM or VRAM." }));
    if (value === "local") providerFields.appendChild(h("p", { class: "zao-simple-help", text: "Runs in the browser. No connection or API key needed." }));
    if (value === "jev") {
      const suggestions = h("fieldset", { class: "zao-simple-suggestions" });
      suggestions.append(h("legend", { text: "AI for creating groups" }),
        h("p", { class: "zao-simple-help", text: "Creates the groups automatically before the decision model sorts tabs." }));
      const label = h("label", { class: "zao-simple-field" });
      label.appendChild(h("span", { text: "AI provider" }));
      const provider = h("select", { class: "zao-settings-select" }); provider.dataset.pref = CONFIG.AI_JEV_CATEGORY_PROVIDER_PREF;
      for (const [value, text] of ENGINE_OPTIONS.filter(([value]) => ["openai", "gemini", "custom", "ollama"].includes(value))) {
        const option = h("option", { text }); option.value = value; provider.appendChild(option);
      }
      const selected = readString(CONFIG.AI_JEV_CATEGORY_PROVIDER_PREF, "openai");
      renderedCategoryProvider = selected;
      provider.value = selected;
      provider.addEventListener("change", () => { save(CONFIG.AI_JEV_CATEGORY_PROVIDER_PREF, provider.value); renderConnection("jev"); });
      label.appendChild(provider); suggestions.appendChild(label);
      for (const descriptor of fieldsFor(selected)) addField(descriptor, suggestions);
      providerFields.appendChild(suggestions);
    }
    if (["openai", "gemini", "custom", "jev"].includes(value)) checkbox(CONFIG.AI_PROVIDER_CONSENT_PREF,
      "Allow sending tab titles, site paths, and current group names to the selected AI providers", providerFields);
    checkbox(CONFIG.AI_REVIEW_PREF, "Review groups before applying", providerFields);
  };
  engine.addEventListener("change", () => {
    save(CONFIG.AI_ENGINE_PREF, engine.value);
    renderConnection(engine.value);
  });
  root._zaoRefresh = () => {
    const selected = readString(CONFIG.AI_ENGINE_PREF, "off");
    engine.value = selected;
    if (renderedEngine !== selected || (selected === "jev" &&
      renderedCategoryProvider !== readString(CONFIG.AI_JEV_CATEGORY_PROVIDER_PREF, "openai"))) renderConnection(selected);
    for (const { input, pref, fallback, checkbox: isCheckbox } of controls) {
      if (input === document.activeElement) continue;
      if (isCheckbox) input.checked = boolPref(pref, fallback);
      else input.value = readString(pref, fallback);
    }
  };
  root._zaoRefresh();
  return root;
};
