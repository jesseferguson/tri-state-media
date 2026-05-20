import { choiceLists } from "../resourceConfig";
import { emptyFlexDieFilters } from "../lib/filtering";

function linerOptions(rows = []) {
  if (!rows.length) return choiceLists.linerType;
  return rows.map((row) => [
    row.name || row.code,
    [row.name, row.code, row.liner_pounds ? `${row.liner_pounds}#` : "", row.material_family].filter(Boolean).join(" / "),
  ]);
}

export default function FlexDieSearch({ filters, setFilters, liners = [] }) {
  function set(name, value) {
    setFilters((prev) => ({ ...prev, [name]: value }));
  }

  return (
    <section className="search-panel compact-card">
      <div className="panel-head thin">
        <div>
          <p className="eyebrow">Flex Die Search</p>
          <h2>Find exact tooling fast</h2>
        </div>
        <button className="ghost-btn" type="button" onClick={() => setFilters(emptyFlexDieFilters)}>Clear</button>
      </div>
      <div className="search-grid">
        <label className="field field-wide"><span>Search</span><input value={filters.text} onChange={(e) => set("text", e.target.value)} placeholder="die jacket, serial, supplier, location..." /></label>
        <label className="field"><span>Width</span><input type="number" step="0.0001" value={filters.width} onChange={(e) => set("width", e.target.value)} /></label>
        <label className="field"><span>Length</span><input type="number" step="0.0001" value={filters.length} onChange={(e) => set("length", e.target.value)} /></label>
        <label className="field"><span>Repeat</span><input type="number" step="0.0001" value={filters.repeat} onChange={(e) => set("repeat", e.target.value)} /></label>
        <label className="field"><span>Gear</span><input type="number" value={filters.gear} onChange={(e) => set("gear", e.target.value)} /></label>
        <label className="field"><span>Across</span><input type="number" value={filters.across} onChange={(e) => set("across", e.target.value)} /></label>
        <label className="field"><span>Around</span><input type="number" value={filters.around} onChange={(e) => set("around", e.target.value)} /></label>
        <label className="field"><span>Shape</span><select value={filters.shape} onChange={(e) => set("shape", e.target.value)}><option value="">Any</option>{choiceLists.shapeType.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="field"><span>Cutting</span><select value={filters.cutting} onChange={(e) => set("cutting", e.target.value)}><option value="">Any</option>{choiceLists.cuttingType.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="field"><span>Face</span><select value={filters.face} onChange={(e) => set("face", e.target.value)}><option value="">Any</option>{choiceLists.faceType.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="field"><span>Liner</span><select value={filters.liner} onChange={(e) => set("liner", e.target.value)}><option value="">Any</option>{linerOptions(liners).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
    </section>
  );
}
