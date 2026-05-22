import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Edit3 } from "lucide-react";
import { choiceLists } from "../resourceConfig";
import { formatInches, labelize } from "../lib/format";

const choiceLookup = Object.fromEntries(
  ["faceType", "linerType", "shapeType", "cuttingType"].flatMap((listKey) =>
    (choiceLists[listKey] ?? []).map(([value, label]) => [`${listKey}:${value}`, label])
  )
);

function choiceLabel(listKey, value, fallback = "Unspecified") {
  if (value === null || value === undefined || value === "") return fallback;
  return choiceLookup[`${listKey}:${value}`] ?? labelize(value);
}

function sizeLabel(row) {
  return `${formatInches(row.label_width_inches)} x ${formatInches(row.label_length_inches)}`;
}

function cutLabel(row) {
  return `${choiceLabel("shapeType", row.shape_type, "Unspecified Shape")} / ${choiceLabel("cuttingType", row.cutting_type, "Unspecified Cut")}`;
}

function groupKey(value) {
  return String(value ?? "Unspecified").trim().toLowerCase();
}

function leafKey(row) {
  return [
    groupKey(row.face_type),
    groupKey(row.liner_type),
    groupKey(row.shape_type),
    groupKey(row.cutting_type),
    row.label_width_inches ?? "",
    row.label_length_inches ?? "",
  ].join("|");
}

function sortedEntries(map) {
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

function ensureGroup(map, key, label) {
  if (!map.has(key)) map.set(key, { key, label, count: 0, children: new Map(), rows: [] });
  return map.get(key);
}

function buildGroups(rows) {
  const faceMap = new Map();

  rows.forEach((row) => {
    const face = ensureGroup(faceMap, groupKey(row.face_type), choiceLabel("faceType", row.face_type, "No Face"));
    const liner = ensureGroup(face.children, groupKey(row.liner_type), choiceLabel("linerType", row.liner_type, "No Liner"));
    const cut = ensureGroup(liner.children, `${groupKey(row.shape_type)}|${groupKey(row.cutting_type)}`, cutLabel(row));
    const size = ensureGroup(cut.children, leafKey(row), sizeLabel(row));

    face.count += 1;
    liner.count += 1;
    cut.count += 1;
    size.count += 1;
    size.rows.push(row);
  });

  return sortedEntries(faceMap).map((face) => ({
    ...face,
    children: sortedEntries(face.children).map((liner) => ({
      ...liner,
      children: sortedEntries(liner.children).map((cut) => ({
        ...cut,
        children: sortedEntries(cut.children).map((size) => ({
          ...size,
          rows: [...size.rows].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, { numeric: true })),
        })),
      })),
    })),
  }));
}

function perfText(row) {
  const external = row.perf_option === "perf"
    ? `External ${row.tpi ? `${row.tpi} TPI` : "Perf"}`
    : "No External Perf";
  const internal = row.internal_perf_option === "perf"
    ? `Internal ${row.internal_perf_tpi ? `${row.internal_perf_tpi} TPI` : "Perf"}`
    : "";
  return [external, internal].filter(Boolean).join(" / ");
}

function RecipeRow({ row, selected, onSelect, onEdit }) {
  return (
    <article
      className={`layout-recipe-row ${selected ? "selected" : ""} ${row.is_active === false ? "inactive" : ""}`}
      onClick={() => onSelect(row)}
    >
      <div>
        <strong>{row.name || "Unnamed layout"}</strong>
        <span>{perfText(row)}</span>
      </div>
      <div className="layout-recipe-metrics">
        <span>Repeat <strong>{formatInches(row.repeat_inches)}</strong></span>
        <span>Status <strong>{row.is_active === false ? "Inactive" : "Active"}</strong></span>
      </div>
      <button
        type="button"
        className="layout-recipe-edit"
        onClick={(event) => {
          event.stopPropagation();
          onEdit(row);
        }}
      >
        <Edit3 size={13} /> Edit
      </button>
    </article>
  );
}

function GroupButton({ open, label, eyebrow, count, onClick }) {
  return (
    <button type="button" className="layout-group-head" onClick={onClick}>
      <span className="layout-group-toggle">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
      <span className="layout-group-title">
        <em>{eyebrow}</em>
        <strong>{label}</strong>
      </span>
      <span className="layout-group-count">{count} layout{count === 1 ? "" : "s"}</span>
    </button>
  );
}

function LayoutGroup({ group, level, path, selectedId, onSelect, onEdit, openKeys, toggleOpen }) {
  const id = `${path}/${group.key}`;
  const open = openKeys.has(id);
  const labels = ["Face", "Liner", "Cutting Shape", "Size"];

  return (
    <section className={`layout-group level-${level}`}>
      <GroupButton
        open={open}
        label={group.label}
        eyebrow={labels[level] ?? "Group"}
        count={group.count}
        onClick={() => toggleOpen(id)}
      />
      {open && (
        <div className="layout-group-body">
          {level < 3 ? (
            group.children.map((child) => (
              <LayoutGroup
                key={child.key}
                group={child}
                level={level + 1}
                path={id}
                selectedId={selectedId}
                onSelect={onSelect}
                onEdit={onEdit}
                openKeys={openKeys}
                toggleOpen={toggleOpen}
              />
            ))
          ) : (
            <div className="layout-recipe-list">
              {group.rows.map((row) => (
                <RecipeRow
                  key={row.id}
                  row={row}
                  selected={selectedId === row.id}
                  onSelect={onSelect}
                  onEdit={onEdit}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function LabelLayoutsView({ rows, selectedId, onSelect, onEdit }) {
  const groups = useMemo(() => buildGroups(rows ?? []), [rows]);
  const [openKeys, setOpenKeys] = useState(() => new Set());

  function toggleOpen(id) {
    setOpenKeys((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!rows?.length) return <p className="label-layout-empty">No label layouts match this view.</p>;

  return (
    <div className="label-layout-view">
      {groups.map((group) => (
        <LayoutGroup
          key={group.key}
          group={group}
          level={0}
          path="layouts"
          selectedId={selectedId}
          onSelect={onSelect}
          onEdit={onEdit}
          openKeys={openKeys}
          toggleOpen={toggleOpen}
        />
      ))}
    </div>
  );
}
