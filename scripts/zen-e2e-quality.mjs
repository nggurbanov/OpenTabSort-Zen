const DEFAULT_THRESHOLDS = {
  f1: 0.9,
  weightedRecall: 0.9,
  singletonRate: 0.25,
  maxGroupMultiplier: 1.2,
};

export const scoreZenQuality = ({ tabCount, goldTabs, predictedGroups, thresholds = DEFAULT_THRESHOLDS }) => {
  const familyByTab = new Map(goldTabs.map((tab) => [tab.id, tab.family]));
  const familySizes = countFamilies(goldTabs);
  const uniquePredictedTabs = new Set();
  const unknownPredictedTabs = new Set();
  const tabMemberships = new Map();
  let duplicateWithinGroupCount = 0;
  const groupStats = predictedGroups.map((group) => {
    const tabs = [...new Set(group.tabs)];
    duplicateWithinGroupCount += Math.max(0, group.tabs.length - tabs.length);
    for (const tabId of tabs) {
      tabMemberships.set(tabId, (tabMemberships.get(tabId) || 0) + 1);
      if (familyByTab.has(tabId)) uniquePredictedTabs.add(tabId);
      else unknownPredictedTabs.add(tabId);
    }
    const overlaps = countGroupFamilies(tabs, familyByTab);
    const majorityCount = Math.max(0, ...overlaps.values());
    return {
      size: tabs.length,
      knownSize: [...overlaps.values()].reduce((sum, count) => sum + count, 0),
      majorityCount,
      coherent: tabs.length > 0 && majorityCount / tabs.length >= 0.8,
      overlaps,
    };
  });

  const groupedTabs = uniquePredictedTabs.size;
  const groupCount = predictedGroups.length;
  const familyCount = familySizes.size;
  const maxGroupCount = Math.max(1, Math.ceil(familyCount * thresholds.maxGroupMultiplier));
  const knownMemberships = groupStats.reduce((sum, group) => sum + group.knownSize, 0);
  const duplicateTabCount = [...tabMemberships.values()].filter((count) => count > 1).length;
  const duplicateMembershipCount = [...tabMemberships.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
    + duplicateWithinGroupCount;
  const unknownTabCount = unknownPredictedTabs.size;
  const missingTabCount = goldTabs.filter((tab) => !uniquePredictedTabs.has(tab.id)).length;
  const weightedPurity = knownMemberships === 0
    ? 0
    : roundMetric(groupStats.reduce((sum, group) => sum + group.majorityCount, 0) / knownMemberships);
  const weightedRecall = goldTabs.length === 0
    ? 0
    : roundMetric([...familySizes].reduce((sum, [family, size]) => sum + bestFamilyOverlap(family, groupStats) / size * size, 0) / goldTabs.length);
  const f1 = weightedPurity + weightedRecall === 0
    ? 0
    : roundMetric((2 * weightedPurity * weightedRecall) / (weightedPurity + weightedRecall));
  const singletonRate = predictedGroups.length === 0
    ? 0
    : roundMetric(groupStats.filter((group) => group.size === 1).length / tabCount);
  const coherentGroupRate = predictedGroups.length === 0
    ? 0
    : roundMetric(groupStats.filter((group) => group.coherent).length / predictedGroups.length);
  const pass = f1 >= thresholds.f1
    && weightedRecall >= thresholds.weightedRecall
    && singletonRate <= thresholds.singletonRate
    && groupCount <= maxGroupCount
    && groupedTabs === tabCount
    && duplicateTabCount === 0
    && duplicateMembershipCount === 0
    && unknownTabCount === 0
    && missingTabCount === 0;

  return {
    tabCount,
    groupedTabs,
    groupCount,
    familyCount,
    maxGroupCount,
    weightedPurity,
    weightedRecall,
    f1,
    singletonRate,
    coherentGroupRate,
    duplicateTabCount,
    duplicateMembershipCount,
    unknownTabCount,
    missingTabCount,
    pass,
    thresholds,
  };
};

export const predictedGroupsFromState = (state) => state.groups.map((group) => ({
  label: group.label,
  tabs: group.tabs.map((tab) => tab.id).filter(Boolean),
}));

const countFamilies = (goldTabs) => {
  const counts = new Map();
  for (const tab of goldTabs) counts.set(tab.family, (counts.get(tab.family) || 0) + 1);
  return counts;
};

const countGroupFamilies = (tabIds, familyByTab) => {
  const counts = new Map();
  for (const tabId of tabIds) {
    const family = familyByTab.get(tabId);
    if (family) counts.set(family, (counts.get(family) || 0) + 1);
  }
  return counts;
};

const bestFamilyOverlap = (family, groupStats) => Math.max(
  0,
  ...groupStats.map((group) => group.overlaps.get(family) || 0),
);

const roundMetric = (value) => Number(value.toFixed(6));
