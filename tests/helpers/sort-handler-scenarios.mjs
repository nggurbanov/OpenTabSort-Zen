import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scenarioSource = String.raw`
import fs from "node:fs";
import vm from "node:vm";
import { CONFIG } from "./modules/config.mjs";
import { captureTabSnapshot, isTabSnapshotCurrent, validateAIPlan, reserveNewGroupNames } from "./modules/sort-plan.mjs";
import { sortFailureNotice } from "./modules/sort-failure.mjs";
import { safeProviderErrorMessage } from "./modules/safe-log.mjs";
const scenario = process.argv[2], primary = process.argv[3] === "primary";
const behavior = scenario.replace(/^primary-/, "");
const state = { requests: 0, requestsAfterAbort: 0, apply: 0, mutations: 0, records: 0, imports: [], finishes: [], modalCalls: 0, errors: [], setupCalls: 0, ruleLoads: 0, plannerCalls: 0, pass1Calls: 0, legacyCalls: 0, toasts: [] };
const observers = new Set(), prefs = new Map([[CONFIG.RULES_PREF, JSON.stringify([{name:"Reading",domains:["reading.test"]}])], [CONFIG.AI_ENGINE_PREF, scenario === "rules-only" || scenario === "primary-off" ? "off" : scenario.startsWith("primary-jev-") ? "jev" : scenario === "primary-local" ? "local" : "openai"]]);
prefs.set(CONFIG.AI_REVIEW_PREF, behavior.includes("review"));
prefs.set(CONFIG.AI_SORT_MODE_PREF,"rules-first");
prefs.set(CONFIG.AI_NEW_GROUP_BEHAVIOR_PREF,"identify-only");
prefs.set(CONFIG.AI_JEV_CATEGORIES_PREF,JSON.stringify({w1:[{name:"Manual legacy category",description:"Keep stored data"}]}));
prefs.set(CONFIG.CUSTOM_ICONS_PREF,JSON.stringify([{id:"custom:keep",dataUrl:"data:image/png;base64,keep"}]));
const advancedKeys=[CONFIG.RULES_PREF,CONFIG.AI_SORT_MODE_PREF,CONFIG.AI_NEW_GROUP_BEHAVIOR_PREF,CONFIG.AI_JEV_CATEGORIES_PREF,CONFIG.CUSTOM_ICONS_PREF];
const advancedBefore=JSON.stringify(advancedKeys.map(key=>prefs.get(key)));
const storedRulesBefore = prefs.get(CONFIG.RULES_PREF);
let entered, release;
const started = new Promise((resolve) => entered = resolve), blocked = new Promise((resolve) => release = resolve);
const notify = (name, value) => { prefs.set(name, value); for (const observer of [...observers]) observer.observe(null, "nsPref:changed", name); };
const tab = {isConnected:true,closest:()=>null};
const info = {_tab:tab,url:"https://private.test/path",title:"Private tab",hostname:"private.test",currentGroup:null};
const rules = [{name:"Reading",domains:["reading.test"]}];
const noop = () => {};
let controls, sessionModule, stoppedSignal;
const win = { gZenWorkspaces: { activeWorkspace:"w1", activeWorkspaceElement:{querySelector:()=>null},updateTabsContainers:noop },
  gBrowser:{ tabs:[tab], tabContainer:{addEventListener:noop,removeEventListener:noop}, addTabsProgressListener:noop,removeTabsProgressListener:noop},addEventListener:noop,removeEventListener:noop };
const services = {prefs:{PREF_STRING:32,PREF_BOOL:128,PREF_INT:64,
  getPrefType:(name)=>typeof prefs.get(name)==="boolean"?128:32,
  getStringPref:(name,fallback="")=>prefs.get(name)??fallback,
  getBoolPref:(name)=>prefs.get(name)??false,
  getIntPref:(name)=>prefs.get(name)??0,
  addObserver:(_prefix,observer)=>observers.add(observer),removeObserver:(_prefix,observer)=>observers.delete(observer)}};
const context = vm.createContext({console:{log:noop,warn:noop,error:(...args)=>state.errors.push(String(args[0]))},window:win,Services:services,AbortController,DOMException,queueMicrotask,setTimeout:()=>0});
const plan = () => ({assignedToExisting:[],newGroups:[{name:"AI category",tabs:[info]}],skipped:[],unresolved:[]});
const runProvider = async () => {
  const signal=sessionModule.namespace.getActiveSortSignal();
  stoppedSignal=signal;
  if (signal?.aborted) state.requestsAfterAbort++;
  signal?.throwIfAborted(); state.requests++;
  if (scenario === "primary-lock") { entered(); await blocked; }
  if(behavior==="skip-changed")notify(CONFIG.SKIP_DOMAINS_PREF,JSON.stringify(["private.test"]));
  if(behavior==="provider-changed")notify(CONFIG.AI_OPENAI_MODEL_PREF,"different-model");
  if(behavior==="consent-revoked")notify(CONFIG.AI_PROVIDER_CONSENT_PREF,false);
  if(behavior==="tabs-changed")info.title="User changed the title";
  if(behavior==="stop-during-provider")controls.onStop();
  if (behavior==="provider-failure") return {assignedToExisting:[],newGroups:[],skipped:[],unresolved:[info],failed:"HTTP 401"};
  return plan();
};
const dependencies = {
  "./config.mjs":{CONFIG:{...CONFIG,WIGGLE_DURATION_MS:0},LOG:"test",BUILD_VERSION:"test"},
  "./rules.mjs":{loadRules:async()=>{state.ruleLoads++;return rules;},readSkipDomainsPref:()=>JSON.parse(prefs.get(CONFIG.SKIP_DOMAINS_PREF)||"[]"),isStrictRulesEnforced:()=>false,getAIEngine:()=>prefs.get(CONFIG.AI_ENGINE_PREF),getAISortMode:()=>"rules-first",getAINewGroupBehavior:()=>scenario==="stop-in-preview"?"auto-add":"transient",getAIExistingBehavior:()=>"transient",getAITitleLearning:()=>"off"},
  "./tabs.mjs":{getEligibleTabs:()=>({workspaceId:"w1",tabs:[info]})},
  "./groups.mjs":Object.fromEntries(["consolidateDuplicateGroups","dissolveEmptyGroups","moveTabsToTop","moveUngroupedToTop","syncAllGroupColors"].map(name=>[name,()=>state.mutations++])),
  "./pass1.mjs":{runPass1:()=>{state.pass1Calls++;return ({assignments:[{...info,group:null}],byGroup:new Map(),unmatched:[info]});},applyPass1:()=>{state.mutations++;return {errors:[],failedTabs:[]};},matchesDomain:(hostname,pattern)=>hostname===pattern},
  "./apply-plan.mjs":{applyPass2:(_plan,_workspace,rules,options)=>{state.apply++;state.appliedRules=rules;state.applyOptions=options;return {errors:[],failedTabs:[]};}},
  "./provider-settings.mjs":{readProviderSettings:(_prefs,provider)=>({provider:provider||prefs.get(CONFIG.AI_ENGINE_PREF)})},
  "./provider-readiness.mjs":{getProviderReadiness:(settings)=>({ok:scenario!=="primary-missing-consent"&&!(scenario==="primary-jev-unready"&&settings.provider==="jev")&&!(scenario==="primary-jev-category-unready"&&settings.provider==="openai"),reason:"consent_required"})},
  "./sorting-mode.mjs":{resolveEffectiveSortingMode:()=>"rules-first",isFullAIMode:()=>false},
  "./ui-toast.mjs":{showToast:(message)=>state.toasts.push(message)},
  "./sort-plan.mjs":{captureTabSnapshot,isTabSnapshotCurrent,validateAIPlan,reserveNewGroupNames},
  "./operation-ui.mjs":{showSortProgress:(callbacks)=>{controls=callbacks;return {stage:noop,setupAvailable:noop,finish:(message,canUndo)=>state.finishes.push({message,canUndo})};}},
  "./tab-history.mjs":{captureLayout:()=>[{ref:tab,group:null,position:0}],recordSortUndo:()=>{state.records++;return true;},undoLastSort:noop,clearSortUndo:noop,canUndoLastSort:()=>false},
  "./remote-provider.mjs":{runPass2Remote:runProvider,runPass2RemoteFresh:runProvider,classifyExistingGroupsRemoteBatch:async()=>new Map()},
  "./preview-modal.mjs":{showPreviewModal:async({signal,plan})=>{
    state.modalCalls++;
    if (behavior==="review-cancel") return null;
    if (behavior==="review-apply") return plan;
    controls.onStop();signal.throwIfAborted();return null;
  }},
  "./setup-navigation.mjs":{openAISetup:()=>state.setupCalls++},
  "./sort-failure.mjs":{sortFailureNotice},
  "./safe-log.mjs":{safeProviderErrorMessage},
  "./jev-categories.mjs":{readJevSettings:()=>({consent:true,endpoint:"https://decision.test",apiKey:"test",model:"test",categoryProvider:"openai"})},
  "./ai-workspace-plan.mjs":{planAIWorkspace:async(tabs,options)=>{state.plannerCalls++;state.plannedCount=tabs.length;state.plannerOptions={engine:options.engine};return runProvider();}},
  "./ai.mjs":{runPass2Fresh:async(tabs,rules)=>{state.localRules=rules;state.plannerCalls++;return runProvider();}},
  "./jev-sort.mjs":{runJevSort:async(options)=>{state.jevOptions={source:options.sourceOverride,review:options.previewOverride,persistCategories:options.persistCategories};}},
  "./legacy-sort.mjs":{handleLegacyOrganizeClick:async()=>{state.legacyCalls++;entered();await blocked;}}

};
const source=fs.readFileSync(primary ? "modules/click-handler.mjs" : "modules/legacy-sort.mjs","utf8");
const exportNames=new Map([...source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*"([^"]+)";/g)].map(match=>[match[2],match[1].split(",").map(name=>name.trim()).filter(Boolean)]));
const cache=new Map();
const getModule=async(specifier)=>{
 if(cache.has(specifier))return cache.get(specifier);
 let module;
 if(specifier==="./sort-session.mjs"){
  module=new vm.SourceTextModule(fs.readFileSync("modules/sort-session.mjs","utf8"),{context});
  cache.set(specifier,module);await module.link(getModule);sessionModule=module;
 }else{
  const values=dependencies[specifier];
  if(!values)throw new Error("Unexpected dependency: "+specifier);
  const names=exportNames.get(specifier)||Object.keys(values);
  module=new vm.SyntheticModule(names,function(){for(const name of names)this.setExport(name,values[name]??noop);},{context});
  cache.set(specifier,module);await module.link(getModule);
 }
 return module;
};
const module=new vm.SourceTextModule(source,{context,importModuleDynamically:async(specifier)=>{
 state.imports.push(specifier);
 const imported=await getModule(specifier);await imported.evaluate();
 if((specifier==="./remote-provider.mjs"||specifier==="./ai-workspace-plan.mjs")&&behavior==="stop-before-provider")controls.onStop();
 return imported;
}});
await module.link(getModule);await module.evaluate();
if (scenario==="primary-lock") {
  const pending=module.namespace.handleOrganizeClick();await started;
  await module.namespace.handleLegacyOrganizeClick();release();await pending;
} else if (scenario==="primary-legacy-lock") {
  const pending=module.namespace.handleLegacyOrganizeClick();await started;
  await module.namespace.handleOrganizeClick();release();await pending;
} else await module.namespace[primary?"handleOrganizeClick":"handleLegacyOrganizeClick"]();
state.rulesPreserved=prefs.get(CONFIG.RULES_PREF)===storedRulesBefore;
state.advancedPreserved=JSON.stringify(advancedKeys.map(key=>prefs.get(key)))===advancedBefore;
state.observersLeft=observers.size;state.activeSignal=sessionModule?.namespace.getActiveSortSignal()!==undefined;state.aborted=stoppedSignal?.aborted;
process.stdout.write(JSON.stringify(state));
`;

export const runScenario = (scenario, { primary = false } = {}) => {
  const result = spawnSync(process.execPath, ["--experimental-vm-modules", "--input-type=module", "-", scenario, primary ? "primary" : "legacy"], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)), input: scenarioSource, encoding: "utf8", timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
};
