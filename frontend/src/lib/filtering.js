import { eqLoose, includesText, numberNear } from "./format";

export const emptyFlexDieFilters = {
  text: "",
  width: "",
  length: "",
  repeat: "",
  gear: "",
  across: "",
  around: "",
  shape: "",
  cutting: "",
  face: "",
  liner: "",
};

export function filterFlexDies(rows, filters) {
  const f = { ...emptyFlexDieFilters, ...filters };
  return rows.filter((die) => {
    const textHaystack = [
      die.name,
      die.tool_number,
      die.drawing_number,
      die.notes,
      die.supplier_name,
      die.current_location_name,
      die.shape_type,
      die.cutting_type,
      die.face_type,
      die.liner_type,
    ].join(" ");

    return (
      includesText(textHaystack, f.text) &&
      numberNear(die.label_width_inches ?? die.width, f.width, 0.005) &&
      numberNear(die.label_length_inches ?? die.length, f.length, 0.005) &&
      numberNear(die.repeat_inches, f.repeat, 0.005) &&
      numberNear(die.gear ?? die.tooth_count, f.gear, 0.1) &&
      numberNear(die.number_across ?? die.across, f.across, 0.1) &&
      numberNear(die.number_around ?? die.around, f.around, 0.1) &&
      eqLoose(die.shape_type, f.shape) &&
      eqLoose(die.cutting_type, f.cutting) &&
      eqLoose(die.face_type, f.face) &&
      eqLoose(die.liner_type, f.liner)
    );
  });
}

export function filterRows(rows, search) {
  const needle = String(search ?? "").trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(needle));
}
