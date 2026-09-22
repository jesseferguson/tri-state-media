const productStatuses = new Set(["unscheduled", "scheduled", "ready", "running", "on_hold"]);
const materialStatuses = new Set(["scheduled", "running", "on_hold"]);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function statusOf(row) {
  return String(row?.status || "scheduled").toLowerCase();
}

export function lineupPressId(item) {
  const value = item?.row?.press;
  return value === null || value === undefined || value === "" ? "" : String(value);
}

export function lineupItemTitle(item) {
  const row = item?.row || {};
  return String(item?.kind === "material"
    ? row.scheduled_material_name || row.produced_material_name || row.name || row.tag_number || "Material Run"
    : row.job_name || row.job_product_code || row.job_ticket_number || row.name || "Job Ticket");
}

export function createLineupItems(productRows = [], materialRows = []) {
  const items = [];
  const seen = new Set();
  function add(row, kind) {
    if (row?.id === null || row?.id === undefined) return;
    const key = `${kind}-${row.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const item = { key, kind, row };
    items.push({ ...item, pressId: lineupPressId(item), title: lineupItemTitle(item) });
  }
  productRows.forEach((row) => {
    if (productStatuses.has(statusOf(row))) add(row, "product");
  });
  materialRows.forEach((row) => {
    const isParent = !row?.source_schedule;
    const isSchedule = row?.log_inventory === false || (row?.is_schedule === true && row?.log_inventory !== true);
    if (isParent && isSchedule && materialStatuses.has(statusOf(row))) add(row, "material");
  });
  return items.sort(compareLineupItems);
}

function sequenceOf(item) {
  const value = Number(item?.row?.press_sequence);
  return Number.isFinite(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
}

function dateOf(item) {
  const row = item.row;
  return String(item.kind === "material"
    ? row.run_date || row.created_at || ""
    : row.scheduled_date || row.order_date || row.due_date || row.created_at || "").slice(0, 10);
}

export function compareLineupItems(a, b) {
  const leftPress = lineupPressId(a);
  const rightPress = lineupPressId(b);
  if (leftPress !== rightPress) {
    if (!leftPress) return -1;
    if (!rightPress) return 1;
    const nameOrder = collator.compare(a.row.press_name || `Press ${leftPress}`, b.row.press_name || `Press ${rightPress}`);
    if (nameOrder) return nameOrder;
    return collator.compare(leftPress, rightPress);
  }
  const sequence = sequenceOf(a) - sequenceOf(b);
  if (sequence) return sequence;
  const date = collator.compare(dateOf(a), dateOf(b));
  if (date) return date;
  if (a.kind !== b.kind) return a.kind === "material" ? -1 : 1;
  return collator.compare(lineupItemTitle(a), lineupItemTitle(b)) || collator.compare(String(a.row.id), String(b.row.id));
}

export function matchesPressScope(item, scope = "all") {
  const key = typeof scope === "string" ? scope : scope?.key || "all";
  if (key === "all") return true;
  if (key === "unassigned") return !lineupPressId(item);
  const pressId = typeof scope === "object" && scope?.pressId !== undefined
    ? String(scope.pressId)
    : key.startsWith("press-") ? key.slice(6) : "";
  return Boolean(pressId) && lineupPressId(item) === pressId;
}

export function buildPressScopes(items = [], presses = []) {
  const assignments = new Map();
  items.forEach((item) => {
    const id = lineupPressId(item);
    if (id && !assignments.has(id)) assignments.set(id, item.row.press_name || `Press ${id}`);
  });
  const byId = new Map();
  presses.forEach((press) => {
    if (press?.id === null || press?.id === undefined) return;
    const id = String(press.id);
    if (press.is_active !== false || assignments.has(id)) {
      byId.set(id, { key: `press-${id}`, pressId: id, label: press.name || `Press ${id}`, isInactive: press.is_active === false });
    }
  });
  assignments.forEach((label, id) => {
    if (!byId.has(id)) byId.set(id, { key: `press-${id}`, pressId: id, label, isInactive: false, isOrphan: true });
  });
  const pressScopes = [...byId.values()].sort((a, b) => collator.compare(a.label, b.label) || collator.compare(a.pressId, b.pressId));
  return [
    { key: "all", label: "All presses", pressId: null },
    { key: "unassigned", label: "Unassigned", pressId: "" },
    ...pressScopes,
  ].map((scope) => {
    const scoped = items.filter((item) => matchesPressScope(item, scope));
    return {
      ...scope,
      count: scoped.length,
      productCount: scoped.filter((item) => item.kind === "product").length,
      materialCount: scoped.filter((item) => item.kind === "material").length,
      runningCount: scoped.filter((item) => statusOf(item.row) === "running").length,
      heldCount: scoped.filter((item) => statusOf(item.row) === "on_hold").length,
    };
  });
}

function matchesSearch(item, query) {
  if (!query) return true;
  const row = item.row;
  const dynamicFileLabel = row.job_print_method === "dynamic"
    ? row.dynamic_file_created ? [row.dynamic_start_number, row.dynamic_end_number].filter(Boolean).join(" - ") || "File created" : "Files not created"
    : "";
  return [
    item.kind, lineupItemTitle(item), row.press_name, row.tag_number, row.cut_description,
    row.job_ticket_number, row.customer_name, row.customer_po, row.job_name, row.job_product_code,
    row.scheduled_material_name, row.produced_material_name, row.job_material_spec_name,
    row.job_material_spec_code, row.job_material_spec_master_type_code, row.job_material_master_type_code,
    row.status, String(row.status || "").replaceAll("_", " "), row.priority, { hot: "high", rush: "medium", normal: "low" }[row.priority],
    row.operator, row.scheduled_by, row.last_updated_by, row.notes, row.operator_notes,
    row.hold_reasons, row.hold_notes, row.held_by, row.dynamic_file_notes,
    row.dynamic_start_number, row.dynamic_end_number, dynamicFileLabel,
  ].some((value) => String(value ?? "").toLowerCase().includes(query));
}

export function filterLineupItems(items = [], { scope = "all", status = "all", workType = "all", query = "" } = {}) {
  const search = String(query).trim().toLowerCase();
  return items.filter((item) => matchesPressScope(item, scope)
    && (status === "all" || statusOf(item.row) === status)
    && (workType === "all" || item.kind === workType)
    && matchesSearch(item, search)).sort(compareLineupItems);
}

export function groupLineupItems(items = [], scopes = buildPressScopes(items)) {
  return scopes.filter((scope) => scope.key !== "all")
    .map((scope) => ({ ...scope, items: items.filter((item) => matchesPressScope(item, scope)).sort(compareLineupItems) }))
    .filter((scope) => scope.items.length > 0);
}

export function buildLineupPositions(items = []) {
  const positions = new Map();
  groupLineupItems(items).forEach((group) => group.items.forEach((item, index) => positions.set(item.key, index + 1)));
  return positions;
}
