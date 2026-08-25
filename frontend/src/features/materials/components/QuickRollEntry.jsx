import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

function materialLabel(row) {
  return [row.material_family, row.name, row.code].filter(Boolean).join(" / ");
}

function locationLabel(row) {
  return row.full_path || row.name;
}

export default function QuickRollEntry({ materials, locations, submitting, onSubmit }) {
  const [open, setOpen] = useState(false);
  const [materialQuery, setMaterialQuery] = useState("");
  const [form, setForm] = useState({
    material: "",
    lot_number: "",
    width_inches: "",
    length_feet: "",
    location: "",
  });

  const sortedMaterials = useMemo(() => {
    const query = materialQuery.trim().toLowerCase();
    return [...(materials ?? [])]
      .filter((row) => row.material_type === "coated_stock")
      .filter((row) => !query || materialLabel(row).toLowerCase().includes(query))
      .sort((a, b) => materialLabel(a).localeCompare(materialLabel(b)))
      .slice(0, 150);
  }, [materialQuery, materials]);

  function update(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function submit(event) {
    event.preventDefault();
    onSubmit({
      material: Number(form.material),
      lot_number: form.lot_number,
      width_inches: form.width_inches === "" ? null : Number(form.width_inches),
      length_feet: form.length_feet === "" ? null : Number(form.length_feet),
      quantity: form.length_feet === "" ? 0 : Number(form.length_feet),
      location: form.location ? Number(form.location) : null,
      status: "available",
      unit: "lf",
      is_active: true,
    });
    setForm({ material: "", lot_number: "", width_inches: "", length_feet: "", location: "" });
    setOpen(false);
  }

  return (
    <section className="quick-roll-entry">
      <button className="quick-roll-toggle" type="button" onClick={() => setOpen((value) => !value)}>
        <Plus size={15} />
        <span>New Roll</span>
      </button>

      {open && (
        <form className="quick-roll-form" onSubmit={submit}>
          <div className="quick-roll-material">
            <input value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} placeholder="Search finished material family..." />
            <select value={form.material} required onChange={(event) => update("material", event.target.value)}>
              <option value="">Finished Material / Family</option>
              {sortedMaterials.map((row) => <option key={row.id} value={row.id}>{materialLabel(row)}</option>)}
            </select>
          </div>
          <input value={form.lot_number} onChange={(event) => update("lot_number", event.target.value)} placeholder="Lot #" />
          <input type="number" step="0.001" value={form.width_inches} onChange={(event) => update("width_inches", event.target.value)} placeholder="Width" />
          <input type="number" step="0.01" value={form.length_feet} onChange={(event) => update("length_feet", event.target.value)} placeholder="Feet" />
          <select value={form.location} onChange={(event) => update("location", event.target.value)}>
            <option value="">Location</option>
            {(locations ?? []).map((row) => <option key={row.id} value={row.id}>{locationLabel(row)}</option>)}
          </select>
          <button className="primary-btn" type="submit" disabled={submitting}>{submitting ? "Adding..." : "Add Roll"}</button>
        </form>
      )}
    </section>
  );
}
