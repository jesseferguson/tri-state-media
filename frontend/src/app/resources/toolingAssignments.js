function normalizeToolKey(value) {
  return String(value ?? "").trim().toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function assignmentToolDetails(tool) {
  return tool?.tool_details ?? tool?.flex_die_details ?? tool?.mag_details ?? tool?.perf_cylinder_details ?? tool?.perf_blade_setup_details ?? {};
}

function assignmentToolTarget(tool) {
  const details = assignmentToolDetails(tool);
  const type = normalizeToolKey(tool?.tool_type ?? details.type);
  if (type.includes("flex_die")) return { resourceKey: "flex-dies", id: tool.flex_die ?? details.id };
  if (type.includes("mag") && !type.includes("perf")) return { resourceKey: "mags", id: tool.mag ?? details.id };
  if (type.includes("perf_blade_setup")) return { resourceKey: "perf-blade-setups", id: tool.perf_blade_setup ?? details.id };
  if (type.includes("perf_cylinder") || type.includes("perf")) return { resourceKey: "perf-cylinders", id: tool.perf_cylinder ?? details.id };
  return { resourceKey: "", id: null };
}

export { assignmentToolDetails, assignmentToolTarget };
