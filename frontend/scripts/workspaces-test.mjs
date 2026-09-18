// Metrivia workspace store tests — dependency-free focused checks.
//
// Covers the Phase C workspace manager pure logic (no React, no DOM):
// create / switch / close / close-active / close-final / duplicate names /
// isolated filters+chart config / async upload ownership / rename / patch
// safety. The reducer + helpers live in src/lib/workspace-store.js, which
// has no DOM/fetch/@/ imports, so node can import it directly.
//
// Usage:  npm run workspaces:test   (from frontend/)
// Exit code is non-zero on any failure.
import { register } from "node:module";

register(new URL("./alias-hooks.mjs", import.meta.url));

const bust = () =>
  `?ws=${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
const storeUrl = (rel) =>
  String(new URL(`../src/lib/${rel}`, import.meta.url));

const store = await import(`${storeUrl("workspace-store.js")}${bust()}`);
const {
  UNTITLED_LABEL,
  createInitialStoreState,
  getActiveWorkspace,
  getWorkspaceBaseName,
  getWorkspaceDisplayNames,
  workspaceReducer,
} = store;

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

const names = (s) => getWorkspaceDisplayNames(s.workspaces);
const ids = (s) => s.workspaces.map((w) => w.id);

// --- initial ---------------------------------------------------------------
let s = createInitialStoreState();
check(
  "W1 fresh session has exactly one Untitled workspace",
  s.workspaces.length === 1 &&
    s.activeId === s.workspaces[0].id &&
    getWorkspaceBaseName(s.workspaces[0]) === UNTITLED_LABEL,
  JSON.stringify(names(s)),
);
check(
  "W2 fresh workspace seeds null dataset + valid filters/chart defaults",
  getActiveWorkspace(s).dataset == null &&
    getActiveWorkspace(s).filters != null &&
    getActiveWorkspace(s).chartConfig != null &&
    getActiveWorkspace(s).status === "idle",
);

// --- create ----------------------------------------------------------------
s = workspaceReducer(s, { type: "create" });
check(
  "W3 create adds a workspace and makes it active",
  s.workspaces.length === 2 && s.activeId === s.workspaces[1].id,
  ids(s).join(","),
);

// --- upload naming + duplicates --------------------------------------------
const salesA = { filename: "sales.csv", row_count: 10, column_count: 2 };
s = workspaceReducer(s, {
  type: "patch",
  id: s.activeId,
  patch: { dataset: salesA, status: "ready" },
});
check(
  "W4 uploaded workspace takes the file name",
  names(s)[s.activeId] === "sales.csv",
  JSON.stringify(names(s)),
);
s = workspaceReducer(s, { type: "create" });
const secondId = s.activeId;
s = workspaceReducer(s, {
  type: "patch",
  id: secondId,
  patch: { dataset: { ...salesA }, status: "ready" },
});
const dupes = names(s);
check(
  "W5 duplicate file names disambiguate as sales.csv / sales.csv (2)",
  Object.values(dupes).includes("sales.csv") &&
    Object.values(dupes).includes("sales.csv (2)"),
  JSON.stringify(dupes),
);

// --- isolation ---------------------------------------------------------------
const firstId = ids(s)[1];
s = workspaceReducer(s, {
  type: "patch",
  id: firstId,
  patch: {
    filters: { categorical: { Region: ["North"] } },
    chartConfig: {
      chartType: "bar",
      dimension: "Region",
      measure: "Sales",
      aggregation: "sum",
    },
  },
});
s = workspaceReducer(s, {
  type: "patch",
  id: secondId,
  patch: {
    filters: { categorical: { Department: ["BCA"] } },
    chartConfig: {
      chartType: "pie",
      dimension: "Department",
      measure: "Students",
      aggregation: "count",
    },
  },
});
const first = s.workspaces.find((w) => w.id === firstId);
const second = s.workspaces.find((w) => w.id === secondId);
check(
  "W6 filters stay isolated per workspace",
  JSON.stringify(first.filters) !== JSON.stringify(second.filters) &&
    first.filters.categorical.Region[0] === "North" &&
    second.filters.categorical.Department[0] === "BCA",
);
check(
  "W7 chart config stays isolated per workspace",
  first.chartConfig.chartType === "bar" &&
    first.chartConfig.dimension === "Region" &&
    second.chartConfig.chartType === "pie" &&
    second.chartConfig.dimension === "Department",
);

// --- switching ---------------------------------------------------------------
s = workspaceReducer(s, { type: "activate", id: firstId });
check(
  "W8 activate switches the active workspace",
  s.activeId === firstId && getActiveWorkspace(s).id === firstId,
);
const before = s;
s = workspaceReducer(s, { type: "activate", id: "ws-nope" });
check("W9 activating an unknown id is a no-op", s === before);

// --- closing -----------------------------------------------------------------
// Close the inactive second workspace: active must not move.
s = workspaceReducer(s, { type: "close", id: secondId });
check(
  "W10 closing an inactive workspace keeps the active one",
  s.activeId === firstId && !ids(s).includes(secondId),
  ids(s).join(","),
);
// Build [A, B, C] with B active, close B → A (previous preferred).
let t = createInitialStoreState();
const aId = t.activeId;
t = workspaceReducer(t, { type: "create" });
const bId = t.activeId;
t = workspaceReducer(t, { type: "create" });
const cId = t.activeId;
t = workspaceReducer(t, { type: "activate", id: bId });
t = workspaceReducer(t, { type: "close", id: bId });
check(
  "W11 closing the active middle tab activates the previous tab",
  t.activeId === aId && ids(t).join(",") === [aId, cId].join(","),
  `active=${t.activeId} order=${ids(t).join(",")}`,
);
// Close active first tab → next tab wins.
t = workspaceReducer(t, { type: "activate", id: aId });
t = workspaceReducer(t, { type: "close", id: aId });
check(
  "W12 closing the active first tab activates the next tab",
  t.activeId === cId && ids(t).join(",") === cId,
  `active=${t.activeId}`,
);
// Closing the final workspace yields a fresh empty one (never zero).
t = workspaceReducer(t, { type: "close", id: cId });
check(
  "W13 closing the final workspace creates a fresh Untitled one",
  t.workspaces.length === 1 &&
    t.activeId === t.workspaces[0].id &&
    getWorkspaceBaseName(t.workspaces[0]) === UNTITLED_LABEL &&
    t.workspaces[0].dataset == null,
  JSON.stringify(names(t)),
);
const ghost = t;
t = workspaceReducer(t, { type: "close", id: "ws-ghost" });
check("W14 closing an unknown id is a no-op", t === ghost);

// --- patch safety / rename / reset -------------------------------------------
const wId = t.activeId;
const patched = workspaceReducer(t, {
  type: "patch",
  id: wId,
  patch: { id: "ws-hacked", status: "ready" },
});
check(
  "W15 patch can never overwrite workspace identity",
  patched.workspaces[0].id === wId && patched.workspaces[0].status === "ready",
);
let r = workspaceReducer(t, {
  type: "rename",
  id: wId,
  name: "  Quarterly  ",
});
check(
  "W16 rename trims and overrides the file-derived label",
  getWorkspaceBaseName(r.workspaces[0]) === "Quarterly",
);
r = workspaceReducer(r, { type: "rename", id: wId, name: "   " });
check(
  "W17 blank rename clears back to the derived label",
  getWorkspaceBaseName(r.workspaces[0]) === UNTITLED_LABEL,
);
let z = workspaceReducer(patched, { type: "reset-workspace", id: wId });
check(
  "W18 reset clears dataset+status but keeps the id",
  z.workspaces[0].id === wId &&
    z.workspaces[0].dataset == null &&
    z.workspaces[0].status === "idle",
);

// --- async upload ownership ----------------------------------------------------
// Simulate: upload starts in A, user switches to B, upload completes.
// The late result must land in A (originator), never B.
let u = createInitialStoreState();
const uA = u.activeId;
u = workspaceReducer(u, { type: "create" });
const uB = u.activeId;
u = workspaceReducer(u, {
  type: "patch",
  id: uA,
  patch: { file: { name: "sales.csv" }, status: "uploading" },
});
u = workspaceReducer(u, { type: "activate", id: uB });
const lateResult = { filename: "sales.csv", row_count: 5, column_count: 1 };
const originStillExists = u.workspaces.some((w) => w.id === uA);
if (originStillExists) {
  u = workspaceReducer(u, {
    type: "patch",
    id: uA,
    patch: { dataset: lateResult, status: "ready", file: null },
  });
}
const uaAfter = u.workspaces.find((w) => w.id === uA);
const ubAfter = u.workspaces.find((w) => w.id === uB);
check(
  "W19 late upload result lands in the originating workspace",
  uaAfter.dataset === lateResult &&
    uaAfter.status === "ready" &&
    ubAfter.dataset == null &&
    ubAfter.status === "idle" &&
    u.activeId === uB,
);
// Completion for a workspace closed mid-upload must not recreate it and
// must not touch the active workspace.
let v = createInitialStoreState();
const vA = v.activeId;
v = workspaceReducer(v, { type: "create" });
const vB = v.activeId;
v = workspaceReducer(v, { type: "close", id: vA });
const vActiveBefore = getActiveWorkspace(v);
const vCountBefore = v.workspaces.length;
// Caller-side membership guard (mirrors Shell): unknown id → no dispatch.
if (v.workspaces.some((w) => w.id === vA)) {
  v = workspaceReducer(v, {
    type: "patch",
    id: vA,
    patch: { dataset: lateResult, status: "ready" },
  });
}
check(
  "W20 result for a closed workspace is dropped safely",
  v.workspaces.length === vCountBefore &&
    !ids(v).includes(vA) &&
    getActiveWorkspace(v) === vActiveBefore &&
    vB === v.activeId,
);

// --- unknown actions ------------------------------------------------------------
const same = workspaceReducer(v, { type: "bogus" });
check("W21 unknown action returns state untouched", same === v);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
