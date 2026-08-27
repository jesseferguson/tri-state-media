import { fetchCollection, requestApi } from "../../api";
import { resourceMap } from "../../resourceConfig";

function mergeRows(existing = [], next = []) {
  const byId = new Map(existing.map((row) => [String(row.id), row]));
  next.forEach((row) => byId.set(String(row.id), { ...(byId.get(String(row.id)) ?? {}), ...row }));
  return Array.from(byId.values());
}

function relationLookupSpec(relation, filters = {}, pageSize = 250, fetchAll = false) {
  const relationResource = resourceMap[relation];
  if (!relationResource) return null;
  return {
    key: relation,
    endpoint: relationResource.endpoint,
    ordering: relationResource.defaultOrdering,
    filters: { ...(relationResource.filters ?? {}), ...(filters ?? {}) },
    pageSize,
    fetchAll,
  };
}

function addLookupSpec(specs, spec) {
  if (!spec) return;
  specs.push(spec);
}

function addFieldLookups(specs, fields = []) {
  fields.forEach((field) => {
    const lookupPageSize = field.lookupPageSize ?? field.maxResults ?? 250;
    const lookupFetchAll = Boolean(field.lookupFetchAll ?? field.fetchAll ?? false);
    if (field.lookupRelation) {
      addLookupSpec(specs, relationLookupSpec(field.lookupRelation, field.lookupFilters, lookupPageSize, lookupFetchAll));
    }
    if (!field.relation || !["relation", "searchRelation", "multiRelation"].includes(field.type)) return;
    addLookupSpec(specs, relationLookupSpec(field.relation, field.lookupFilters, lookupPageSize, lookupFetchAll));
  });
}

async function loadScopedLookups({ resource, selected, isMaterialTypePage, formMode, includeFieldLookups = false }) {
  const specs = [];
  const useJobTicketDetailBundle = resource.key === "job-tickets" && selected?.id;
  const shouldLoadFieldLookups = resource.key !== "job-tickets" || Boolean(formMode || includeFieldLookups || isMaterialTypePage);
  if (shouldLoadFieldLookups) addFieldLookups(specs, resource.fields ?? []);
  const bundledLookupPromise = useJobTicketDetailBundle
    ? requestApi(`job-tickets/${selected.id}/detail-lookups`).catch(() => ({}))
    : Promise.resolve({});

  if (resource.key === "raw-materials" && selected?.id) {
    addLookupSpec(specs, relationLookupSpec("material-usages", { inventory: selected.id }, 100));
  }

  if (resource.key === "material-coated-stock") {
    addLookupSpec(specs, relationLookupSpec("raw-materials", selected?.id ? { material: selected.id } : { material_type: "coated_stock" }, 250));
    if (selected?.id) addLookupSpec(specs, relationLookupSpec("material-usages", { material: selected.id }, 150));
    if (selected?.id) addLookupSpec(specs, {
      key: "coater-roll-tags",
      endpoint: "coater-roll-tags",
      ordering: "-run_date,-created_at",
      filters: { material: selected.id },
      pageSize: 1000,
      fetchAll: true,
    });
    addLookupSpec(specs, relationLookupSpec("presses", {}, 100));
  }

  if (isMaterialTypePage) {
    addLookupSpec(specs, relationLookupSpec("material-supplier-options", { material_type: resource.filters?.material_type }, 1000, true));
  }

  if (resource.endpoint === "materials" && selected?.id) {
    addLookupSpec(specs, relationLookupSpec("material-usages", { material: selected.id }, 150));
  }

  if (resource.key === "customers") {
    addLookupSpec(specs, { key: "customer-open-interactions", endpoint: "customer-interactions", ordering: "follow_up_date,-occurred_at", filters: { open: true }, pageSize: 1000, fetchAll: true });
  }

  if (resource.key === "customers" && selected?.id) {
    addLookupSpec(specs, { key: "quote-records", endpoint: "quote-records", ordering: "-created_at", filters: { customer: selected.id }, pageSize: 1000, fetchAll: true });
    addLookupSpec(specs, relationLookupSpec("customer-orders", { customer: selected.id }, 1000, true));
    addLookupSpec(specs, relationLookupSpec("job-tickets", { customer: selected.id }, 1000, true));
    addLookupSpec(specs, { key: "customer-interactions", endpoint: "customer-interactions", ordering: "-pinned,-occurred_at", filters: { customer: selected.id }, pageSize: 1000, fetchAll: true });
  }

  if (resource.key === "suppliers") {
    addLookupSpec(specs, relationLookupSpec("suppliers", {}, 1000, true));
  }

  if (resource.key === "finished-inventory" && selected?.id) {
    addLookupSpec(specs, relationLookupSpec("material-usages", { finished_inventory: selected.id }, 150));
  }

  if (resource.key === "finished-inventory" && selected?.material_inventory) {
    addLookupSpec(specs, relationLookupSpec("material-usages", { inventory: selected.material_inventory }, 150));
  }

  if (resource.key === "job-tickets" && !selected) {
    addLookupSpec(specs, relationLookupSpec("customers", {}, 1000, true));
    addLookupSpec(specs, relationLookupSpec("production-schedule", {}, 1000, true));
  }

  if (resource.key === "job-tickets" && selected && !useJobTicketDetailBundle) {
    if (selected.material_spec) addLookupSpec(specs, relationLookupSpec("raw-materials", { material: selected.material_spec }, 250));
    if (selected.material_master_type || selected.material_spec_master_type) {
      addLookupSpec(specs, relationLookupSpec("raw-materials", { material_type: "coated_stock", master_type: selected.material_master_type || selected.material_spec_master_type }, 250));
    }
    addLookupSpec(specs, relationLookupSpec("raw-materials", { material_type: "coated_stock" }, 1000, true));
    addLookupSpec(specs, relationLookupSpec("finished-inventory", { job_ticket: selected.id }, 250, true));
    if (selected.product_code) addLookupSpec(specs, relationLookupSpec("finished-inventory", { tsm_id: selected.product_code }, 250, true));
    if (selected.ticket_number) addLookupSpec(specs, relationLookupSpec("finished-inventory", { tsm_id: selected.ticket_number }, 250, true));
    addLookupSpec(specs, relationLookupSpec("material-usages", { finished_inventory_job_ticket: selected.id }, 250, true));
    if (selected.product_code) addLookupSpec(specs, relationLookupSpec("material-usages", { finished_inventory_tsm_id: selected.product_code }, 250, true));
    if (selected.ticket_number) addLookupSpec(specs, relationLookupSpec("material-usages", { finished_inventory_tsm_id: selected.ticket_number }, 250, true));
    addLookupSpec(specs, relationLookupSpec("job-ticket-usages", { job_ticket: selected.id }, 1000, true));
    if (selected.ticket_number) addLookupSpec(specs, relationLookupSpec("job-ticket-usages", { legacy_job_ticket_id: selected.ticket_number }, 250, true));
    if (selected.product_code) addLookupSpec(specs, relationLookupSpec("job-ticket-usages", { legacy_job_ticket_id: selected.product_code }, 250, true));
    if (selected.recipe) addLookupSpec(specs, relationLookupSpec("recipe-options", { recipe: selected.recipe }, 500, true));
    else addLookupSpec(specs, relationLookupSpec("recipe-options", {}, 150));
    addLookupSpec(specs, relationLookupSpec("box-inventory", {}, 150));
    addLookupSpec(specs, relationLookupSpec("core-inventory", {}, 150));
    addLookupSpec(specs, relationLookupSpec("customer-orders", {}, 150));
    addLookupSpec(specs, relationLookupSpec("customer-orders", { job_ticket: selected.id }, 250, true));
    addLookupSpec(specs, relationLookupSpec("customer-order-events", {}, 250));
    addLookupSpec(specs, relationLookupSpec("customer-order-events", { job_ticket: selected.id }, 250, true));
    addLookupSpec(specs, relationLookupSpec("job-ticket-events", { job_ticket: selected.id }, 250));
    addLookupSpec(specs, relationLookupSpec("presses", {}, 150));
  }

  if (resource.key === "production-schedule") {
    addLookupSpec(specs, relationLookupSpec("job-tickets", {}, 1000));
    addLookupSpec(specs, relationLookupSpec("raw-materials", { material_type: "coated_stock" }, 1000));
    addLookupSpec(specs, { key: "coater-roll-tags", endpoint: "coater-roll-tags", ordering: "press__name,press_sequence,run_date,tag_number", pageSize: 1000, fetchAll: true });
    addLookupSpec(specs, relationLookupSpec("recipe-options", {}, 1000));
    addLookupSpec(specs, relationLookupSpec("box-inventory", {}, 250));
    addLookupSpec(specs, relationLookupSpec("core-inventory", {}, 250));
  }

  if (resource.key === "packaging-inventory") {
    addLookupSpec(specs, relationLookupSpec("core-inventory", {}, 500));
  }

  if (resource.key === "flex-dies") {
    addLookupSpec(specs, relationLookupSpec("presses", {}, 500, true));
    if (selected?.id) {
      addLookupSpec(specs, relationLookupSpec("history", { flex_die: selected.id }, 250));
      addLookupSpec(specs, relationLookupSpec("recipe-tools", { flex_die: selected.id }, 500, true));
    }
  }

  if (resource.key === "recipes") {
    addLookupSpec(specs, relationLookupSpec("recipe-options", {}, 1000, true));
    addLookupSpec(specs, relationLookupSpec("recipe-tools", {}, 2000, true));
    addLookupSpec(specs, relationLookupSpec("print-plates", {}, 1000, true));
    addLookupSpec(specs, relationLookupSpec("print-stations", {}, 2000, true));
    addFieldLookups(specs, resourceMap["recipe-options"]?.fields ?? []);
    addFieldLookups(specs, resourceMap["recipe-tools"]?.fields ?? []);
    addFieldLookups(specs, resourceMap["print-plates"]?.fields ?? []);
    addFieldLookups(specs, resourceMap["print-stations"]?.fields ?? []);
  }

  const [bundledLookups, entries] = await Promise.all([
    bundledLookupPromise,
    Promise.all(
      specs.map((spec) =>
        fetchCollection(spec.endpoint, {
          ordering: spec.ordering,
          pageSize: spec.pageSize,
          filters: spec.filters,
          fetchAll: spec.fetchAll,
        })
          .then((payload) => [spec.key, payload.results])
          .catch(() => [spec.key, []])
      )
    ),
  ]);

  return entries.reduce((acc, [key, results]) => {
    acc[key] = mergeRows(acc[key], results);
    return acc;
  }, Object.fromEntries(
    Object.entries(bundledLookups ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value : []])
  ));
}

export { loadScopedLookups, mergeRows };
