export const GOLD_FAMILIES = [
  "WORK",
  "DOCS",
  "RESEARCH",
  "COMM",
  "SHOP",
  "MEDIA",
  "PLAN",
  "FINANCE",
  "SOCIAL",
  "TOOLS",
];

const FAMILY_FIXTURES = {
  WORK: {
    host: "work.localhost",
    title: "Sprint board pull request backlog review",
    path: "workspace",
    color: "blue",
  },
  DOCS: {
    host: "docs.localhost",
    title: "API guide reference changelog docs",
    path: "documentation",
    color: "purple",
  },
  RESEARCH: {
    host: "research.localhost",
    title: "Arxiv benchmark paper notes dataset",
    path: "research",
    color: "green",
  },
  COMM: {
    host: "comm.localhost",
    title: "Inbox slack thread message triage",
    path: "messages",
    color: "orange",
  },
  SHOP: {
    host: "shop.localhost",
    title: "Cart checkout product price comparison",
    path: "shopping",
    color: "pink",
  },
  MEDIA: {
    host: "media.localhost",
    title: "Video playlist podcast episode queue",
    path: "media",
    color: "red",
  },
  PLAN: {
    host: "plan.localhost",
    title: "Calendar itinerary roadmap task planning",
    path: "planning",
    color: "cyan",
  },
  FINANCE: {
    host: "finance.localhost",
    title: "Invoice budget bank statement ledger",
    path: "finance",
    color: "yellow",
  },
  SOCIAL: {
    host: "social.localhost",
    title: "Forum profile feed community thread",
    path: "social",
    color: "magenta",
  },
  TOOLS: {
    host: "tools.localhost",
    title: "Dashboard settings logs admin console",
    path: "tools",
    color: "teal",
  },
};

const HYBRID_RULE_FAMILIES = new Set(["WORK", "DOCS", "FINANCE", "TOOLS"]);
const FAMILY_BY_ID_PREFIX = new Map(GOLD_FAMILIES.map((family) => [family.toLowerCase(), family]));

export const createSemanticFixture = (count, pagePort) => {
  const tabs = Array.from({ length: count }, (_, index) => {
    const family = GOLD_FAMILIES[index % GOLD_FAMILIES.length];
    const fixture = FAMILY_FIXTURES[family];
    const id = `${family.toLowerCase()}-${index}`;
    return {
      id,
      family,
      host: fixture.host,
      title: `${fixture.title} ${index}`,
      url: `http://${fixture.host}:${pagePort}/${fixture.path}/${id}`,
    };
  });
  return {
    tabs,
    goldTabs: tabs.map((tab) => ({ id: tab.id, family: tab.family })),
  };
};

export const hybridRules = () => GOLD_FAMILIES
  .filter((family) => HYBRID_RULE_FAMILIES.has(family))
  .map((family) => {
    const fixture = FAMILY_FIXTURES[family];
    return {
      name: `${family} Rules`,
      domains: [fixture.host],
      color: fixture.color,
    };
  });

export const familyForPromptText = (host, title) => {
  const normalizedHost = String(host || "").toLowerCase();
  for (const family of GOLD_FAMILIES) {
    const fixture = FAMILY_FIXTURES[family];
    if (normalizedHost === fixture.host) return family;
  }
  const text = `${host} ${title}`.toLowerCase();
  for (const family of GOLD_FAMILIES) {
    const fixture = FAMILY_FIXTURES[family];
    const token = fixture.host.replace(".localhost", "");
    if (new RegExp(`\\b${token}\\b`, "i").test(text)) return family;
  }
  return "RESEARCH";
};

export const fixturePageForPath = (path = "") => {
  const id = path.split("/").filter(Boolean).at(-1) || "";
  const [prefix, rawIndex] = id.split("-");
  const family = FAMILY_BY_ID_PREFIX.get(prefix);
  if (!family) return null;
  const fixture = FAMILY_FIXTURES[family];
  const index = Number.parseInt(rawIndex || "", 10);
  const suffix = Number.isInteger(index) ? ` ${index}` : "";
  const title = `${fixture.title}${suffix}`;
  return {
    title,
    description: `${title}. Intent family ${family}: ${fixture.path} tabs for semantic grouping quality.`,
  };
};
