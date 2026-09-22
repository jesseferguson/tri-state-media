import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Factory, Layers3, LoaderCircle, MapPin, PackageCheck, PackagePlus, Plus, Warehouse, X } from "lucide-react";
import IntakeSearchPicker from "./IntakeSearchPicker";
import {
  COMPONENTS, INTAKE_STEPS, ORIGINS, UNITS, findById, formatAmount, initialIntake,
  intakeChoices, intakeErrorMessage, intakePayload, intakeRequestKey, isLiquid, locationLabel, materialLabel,
  needsWidth, rackLabel, resetMaterial, validateIntakeStep,
} from "../intakeWorkflow";
import "./MaterialIntakeDialog.css";

function Field({ name, label, errors, children, hint, wide = false }) {
  return <div className={`intake-field ${wide ? "is-wide" : ""}`}>
    <label htmlFor={`intake-${name}`}>{label}</label>
    {children}
    {hint && <span className="intake-hint" id={`intake-${name}-hint`}>{hint}</span>}
    {errors[name] && <span className="intake-field-error" id={`intake-${name}-error`}>{errors[name]}</span>}
  </div>;
}

function Option({ selected, onClick, icon: Icon, title, detail }) {
  return <button type="button" className={`intake-option ${selected ? "is-selected" : ""}`} aria-pressed={selected} onClick={onClick}>
    <Icon size={24} aria-hidden="true" /><span><strong>{title}</strong><small>{detail}</small></span>
    {selected && <CheckCircle2 size={19} aria-hidden="true" />}
  </button>;
}

function ReviewCard({ title, onEdit, rows }) {
  return <section className="intake-review-card">
    <header><h4>{title}</h4><button type="button" className="intake-text-button" onClick={onEdit} aria-label={`Edit ${title.toLowerCase()}`}>Edit</button></header>
    <dl>{rows.filter(Boolean).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "Not provided"}</dd></div>)}</dl>
  </section>;
}

export default function MaterialIntakeDialog({ materials = [], masterTypes = [], suppliers = [], racks = [], locations = [], saving, onClose, onSave }) {
  const data = { materials, masterTypes, suppliers, racks, locations };
  const [form, setForm] = useState(initialIntake);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState("");
  const [result, setResult] = useState(null);
  const [discard, setDiscard] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef(null);
  const bodyRef = useRef(null);
  const questionRef = useRef(null);
  const submitLock = useRef(false);
  const requestRef = useRef(null);
  const busy = saving || submitting;
  const choices = intakeChoices(data, form);
  const selectedMaterial = findById(choices.materials, form.material);
  const selectedMaster = findById(choices.masterTypes, form.master_type);
  const selectedSupplier = findById(choices.suppliers, form.supplier);
  const selectedLiner = findById(choices.liners, form.liner_material);
  const selectedAdhesive = findById(choices.adhesives, form.adhesive_material);
  const materialName = form.definitionMode === "existing" ? materialLabel(selectedMaterial) : [form.name.trim(), form.company.trim(), selectedLiner?.material_family || selectedLiner?.name, selectedAdhesive?.material_family || selectedAdhesive?.name].filter(Boolean).join(" / ");
  const destination = form.storageMode === "rack" ? rackLabel(findById(choices.racks, form.direct_rack)) : locationLabel(findById(choices.locations, form.location));
  const total = Number(form.amount || 0) * Number(form.roll_count || 0);
  const physicalLabel = needsWidth(form) ? "roll" : "container";
  const amountUnit = form.unit === "lf" ? "ft" : form.unit;

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (busy) return;
    bodyRef.current?.scrollTo({ top: 0 });
    questionRef.current?.focus({ preventScroll: true });
  }, [step, discard, result, busy]);

  useEffect(() => {
    if (saveError && !busy) document.getElementById("intake-save-error")?.focus();
  }, [saveError, busy]);

  useEffect(() => {
    if ((!dirty || result) && !busy) return;
    const preventLoss = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty, result, busy]);

  function change(values) {
    if (submitLock.current || busy) return;
    setDirty(true);
    setErrors({});
    setSaveError("");
    setForm((current) => ({ ...current, ...values }));
  }

  function chooseCategory(category) {
    if (category === form.category) return;
    change(resetMaterial(form, { category, material_type: category === "finished" ? "coated_stock" : "", definitionMode: "existing", unit: "lf" }));
  }

  function chooseComponent(material_type) {
    change(resetMaterial(form, { material_type, unit: isLiquid(material_type) ? "gal" : "lf" }));
  }

  function chooseMaterial(material) {
    const selected = findById(choices.materials, material);
    change({ material, amount: "", width_inches: "", roll_count: "1", supplier: findById(choices.suppliers, selected?.supplier) ? String(selected.supplier) : "" });
  }

  function navigate(nextStep) {
    if (submitLock.current || busy) return;
    setStep(nextStep); setErrors({}); setSaveError("");
  }

  function showErrors(nextErrors, nextStep = step) {
    setStep(nextStep);
    setErrors(nextErrors);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`intake-${Object.keys(nextErrors)[0]}`);
      if (target) target.focus(); else questionRef.current?.focus();
    });
  }

  function requestClose() {
    if (submitLock.current || busy) return;
    if (dirty && !result) setDiscard(true); else onClose();
  }

  async function submit(event) {
    event.preventDefault();
    if (submitLock.current || busy || result || discard) return;
    if (step < 5) {
      const nextErrors = validateIntakeStep(step, form, data);
      if (Object.keys(nextErrors).length) showErrors(nextErrors); else navigate(step + 1);
      return;
    }
    // Enter in a field must never bypass the deliberate final save button.
    if (event.nativeEvent.submitter?.value !== "save") return;
    for (let index = 0; index < 5; index += 1) {
      const nextErrors = validateIntakeStep(index, form, data);
      if (Object.keys(nextErrors).length) { showErrors(nextErrors, index); return; }
    }
    submitLock.current = true;
    setSubmitting(true); setSaveError("");
    try {
      const payload = intakePayload(form);
      const fingerprint = JSON.stringify(payload);
      if (requestRef.current?.fingerprint !== fingerprint) requestRef.current = { fingerprint, key: intakeRequestKey() };
      const saved = await onSave(payload, requestRef.current.key);
      setResult(saved);
    } catch (error) {
      setSaveError(intakeErrorMessage(error));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  function inputProps(name, hint = false) {
    return {
      id: `intake-${name}`, name, value: form[name], onChange: (event) => change({ [name]: event.target.value }),
      required: ["name", "master_type_code", "material_type", "inventory_origin", "received_date", "amount", "roll_count", "width_inches"].includes(name) || (name === "company" && form.category === "finished"),
      "aria-invalid": Boolean(errors[name]),
      "aria-describedby": [errors[name] && `intake-${name}-error`, hint && `intake-${name}-hint`].filter(Boolean).join(" ") || undefined,
    };
  }

  function picker(name, label, options, getLabel, placeholder, optional = false, onChange) {
    return <IntakeSearchPicker id={`intake-${name}`} label={label} options={options} value={form[name]} getLabel={getLabel}
      placeholder={placeholder} optional={optional} error={errors[name]} onChange={onChange || ((value) => change({ [name]: value }))} />;
  }

  const questions = ["What are you adding?", "Which material is it?", "Where did it come from?", "How much are you adding?", "Where will it be stored?", "Does everything look right?"];
  const descriptions = [
    "Start with the kind of material. We’ll guide you through the details.",
    "Find an existing material, or add one if it is not in the catalog.",
    "Record the source and receiving date for this inventory.",
    "Enter the amount for one physical item. We’ll calculate the total.",
    "Choose the actual destination so the next person can find it.",
    "Check the details below. Nothing is added until you confirm.",
  ];

  return <dialog ref={dialogRef} className="material-intake-dialog" aria-labelledby="intake-title" onCancel={(event) => { event.preventDefault(); requestClose(); }}>
    <form className="intake-wizard" onSubmit={submit} noValidate aria-busy={busy}>
      <header className="intake-header">
        <div><span className="intake-eyebrow">Inventory intake</span><h2 id="intake-title">Add material</h2></div>
        <button className="intake-icon-button" type="button" onClick={requestClose} disabled={busy} aria-label="Close material intake"><X size={20} /></button>
      </header>
      {!result && !discard && <>
        <ol className="intake-progress" aria-label="Intake progress">
          {INTAKE_STEPS.map((label, index) => <li key={label} className={index === step ? "is-current" : index < step ? "is-complete" : ""} aria-current={index === step ? "step" : undefined}>
            <button type="button" disabled={index >= step || busy} onClick={() => navigate(index)} aria-label={`Step ${index + 1}: ${label}`}>
              <span className="intake-step-number">{index < step ? <Check size={14} /> : index + 1}</span><span className="intake-step-label">{label}</span>
            </button>
          </li>)}
        </ol>
        <p className="intake-progress-caption" aria-live="polite">Step {step + 1} of {INTAKE_STEPS.length} · {INTAKE_STEPS[step]}</p>
      </>}
      <div className="intake-body" ref={bodyRef} inert={busy || undefined}>
        {discard ? <section className="intake-discard">
          <h3 ref={questionRef} tabIndex={-1} className="intake-question">Discard this entry?</h3>
          <p>{requestRef.current ? "Your entry will be cleared. If a save was interrupted, check inventory before adding the same items again." : "Your unsaved details will be cleared. Nothing has been added to inventory."}</p>
          <button className="primary-btn" type="button" onClick={() => setDiscard(false)}>Keep editing</button>
          <button className="ghost-btn" type="button" onClick={onClose}>Discard entry</button>
        </section> : result ? <section className="intake-success" role="status">
          <CheckCircle2 size={56} aria-hidden="true" />
          <h3 ref={questionRef} tabIndex={-1} className="intake-question">Material added</h3>
          <p><strong>{result.created_count || form.roll_count} {physicalLabel}{Number(result.created_count || form.roll_count) === 1 ? "" : "s"}</strong> · {formatAmount(result.total_received ?? total)} {amountUnit}</p>
          <p>{materialName}</p><p><MapPin size={16} aria-hidden="true" /> {destination}</p>
          {result.serial_number && <p className="intake-hint">First inventory ID: {result.serial_number}</p>}
        </section> : <section className="intake-step" key={step}>
          <h3 ref={questionRef} tabIndex={-1} className="intake-question">{questions[step]}</h3>
          <p className="intake-description">{descriptions[step]}</p>

          {step === 0 && <>
            <div className="intake-options">
              <Option selected={form.category === "finished"} onClick={() => chooseCategory("finished")} icon={PackageCheck} title="Finished raw material" detail="Coated stock ready for production, such as PM, PMDT, or PET." />
              <Option selected={form.category === "raw"} onClick={() => chooseCategory("raw")} icon={Factory} title="Raw component" detail="Face, liner, adhesive, silicone, or coating used to make material." />
            </div>
            {errors.category && <p className="intake-field-error" role="alert">{errors.category}</p>}
            <p className="intake-hint">Finished raw material is production stock, such as coated rolls.</p>
          </>}

          {step === 1 && <>
            {form.category === "raw" && <Field name="material_type" label="Which component?" errors={errors}>
              <select {...inputProps("material_type")} onChange={(event) => chooseComponent(event.target.value)}><option value="">Choose a component</option>{COMPONENTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </Field>}
            {(form.category === "finished" || form.material_type) && <>
              <div className="intake-segmented" aria-label="Material selection">
                <button type="button" className={form.definitionMode === "existing" ? "is-selected" : ""} aria-pressed={form.definitionMode === "existing"} onClick={() => { if (form.definitionMode !== "existing") change(resetMaterial(form, { definitionMode: "existing" })); }}>Use existing material</button>
                <button type="button" className={form.definitionMode === "new" ? "is-selected" : ""} aria-pressed={form.definitionMode === "new"} onClick={() => { if (form.definitionMode !== "new") change(resetMaterial(form, { definitionMode: "new" })); }}><Plus size={15} /> Add new material</button>
              </div>
              {form.definitionMode === "existing" ? <>
                {picker("material", "Material", choices.materials, materialLabel, "Search name, company, or code", false, chooseMaterial)}
                {selectedMaterial && <div className="intake-callout"><Layers3 size={18} /><span><strong>{selectedMaterial.name}</strong><br />{[selectedMaterial.company, selectedMaterial.code].filter(Boolean).join(" · ")}</span></div>}
                {!choices.materials.length && <p className="intake-hint">No materials are listed for this category yet. Choose “Add new material” to create one.</p>}
              </> : <>
                <p className="intake-callout">This also adds a reusable material to the catalog when you finish.</p>
                <div className="intake-fields">
                  {form.category === "finished" && <div className="is-wide">
                    {form.master_type !== "__new__" ? picker("master_type", "Material family", choices.masterTypes, (row) => [row.code, row.name !== row.code && row.name].filter(Boolean).join(" / "), "Search PM, PMDT, PET…") : <Field name="master_type_code" label="New family code" errors={errors}><input {...inputProps("master_type_code")} onChange={(event) => change({ master_type_code: event.target.value.toUpperCase() })} maxLength={50} placeholder="Example: PMDT" /></Field>}
                    <button className="intake-text-button" type="button" onClick={() => change({ master_type: form.master_type === "__new__" ? "" : "__new__", master_type_code: "" })}>{form.master_type === "__new__" ? "Choose an existing family" : "Family not listed? Add one"}</button>
                  </div>}
                  <Field name="name" label="Material name" errors={errors}><input {...inputProps("name")} maxLength={100} placeholder={form.category === "finished" ? "Example: PMDT 40#" : "Example: 40 SCK liner"} /></Field>
                  <Field name="company" label={`Manufacturer / company${form.category === "raw" ? " (optional)" : ""}`} errors={errors}><input {...inputProps("company")} maxLength={120} placeholder="Company that makes it" /></Field>
                </div>
                {form.category === "finished" && <details className="intake-optional" open={errors.liner_material || errors.adhesive_material ? true : undefined}><summary>Liner and adhesive (optional)</summary><div className="intake-fields">
                  {picker("liner_material", "Liner", choices.liners, materialLabel, "Search liner", true)}
                  {picker("adhesive_material", "Adhesive", choices.adhesives, materialLabel, "Search adhesive", true)}
                </div></details>}
              </>}
            </>}
          </>}

          {step === 2 && <div className="intake-fields">
            <Field name="inventory_origin" label="Material source" errors={errors} wide>
              <select {...inputProps("inventory_origin")}><option value="">Choose a source</option>{ORIGINS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </Field>
            {picker("supplier", "Supplier", choices.suppliers, (row) => [row.name, row.city, row.state].filter(Boolean).join(" / "), "Search supplier", true)}
            <Field name="received_date" label="Date received" errors={errors}><input {...inputProps("received_date")} type="date" /></Field>
            {form.inventory_origin === "tri_state" && <p className="intake-callout is-wide">Use manual entry only if these items have not already been added through a production roll tag.</p>}
          </div>}

          {step === 3 && <>
            <div className="intake-fields">
              <Field name="unit" label="How is the amount measured?" errors={errors} wide><select {...inputProps("unit")} onChange={(event) => change({ unit: event.target.value, amount: "" })}>{UNITS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
              <Field name="amount" label={form.unit === "lf" ? "Length per roll (ft)" : `Amount per ${physicalLabel} (${amountUnit})`} errors={errors} hint={`For one ${physicalLabel}, before multiplying by the count.`}>
                <input {...inputProps("amount", true)} type="number" min={form.unit === "lf" ? "0.01" : "0.001"} step={form.unit === "lf" ? "0.01" : "0.001"} inputMode="decimal" placeholder={form.unit === "lf" ? "Example: 5000" : "Example: 55"} />
              </Field>
              <Field name="roll_count" label={`Number of ${physicalLabel}s`} errors={errors} hint="One inventory record is created for each item."><input {...inputProps("roll_count", true)} type="number" min="1" max="500" step="1" inputMode="numeric" /></Field>
              {needsWidth(form) && <Field name="width_inches" label="Roll width (inches)" errors={errors}><input {...inputProps("width_inches")} type="number" min="0.001" step="0.001" inputMode="decimal" placeholder="Example: 13.5" /></Field>}
              <Field name="lot_number" label="Lot number (optional)" errors={errors}><input {...inputProps("lot_number")} maxLength={80} placeholder="Supplier or internal lot" /></Field>
            </div>
            <div className="intake-total" aria-live="polite"><span>Total to add</span><strong>{formatAmount(total)} {amountUnit}</strong><small>{form.roll_count || 0} {physicalLabel}{Number(form.roll_count) === 1 ? "" : "s"} × {formatAmount(form.amount)} {amountUnit} each</small></div>
            <p className="intake-callout">All items in this entry share the same amount, width, lot, and destination. Add a separate entry when any of these differ.</p>
            {isLiquid(form.material_type) && ["lf", "roll"].includes(form.unit) && <p className="intake-callout is-warning">This component is usually measured in gallons or pounds. Confirm that a roll unit is appropriate.</p>}
          </>}

          {step === 4 && <>
            <div className="intake-options">
              <Option selected={form.storageMode === "floor"} onClick={() => change({ storageMode: "floor", direct_rack: "" })} icon={MapPin} title="Floor / location" detail="Place directly at a floor, shelf, or warehouse location." />
              <Option selected={form.storageMode === "rack"} onClick={() => change({ storageMode: "rack", location: "" })} icon={Warehouse} title="Rack space" detail="Place directly into an active material rack." />
            </div>
            {form.storageMode === "rack" ? picker("direct_rack", "Rack", choices.racks, rackLabel, "Search rack or location") : picker("location", "Storage location", choices.locations, (row) => [locationLabel(row), row.code].filter(Boolean).join(" / "), "Search floor, warehouse, shelf, or code")}
            {!(form.storageMode === "rack" ? choices.racks : choices.locations).length && <p className="intake-callout is-warning">No active destinations are available here. Set up a location or rack in Locations before receiving this material.</p>}
            <details className="intake-optional"><summary>Handling notes (optional)</summary><Field name="notes" label="Notes" errors={errors}><textarea {...inputProps("notes")} rows={3} placeholder="Condition or handling instructions" /></Field></details>
            <p className="intake-hint">To group these items on a skid, use Skids after adding them to inventory.</p>
          </>}

          {step === 5 && <>
            <div className="intake-total"><span>Ready to add</span><strong>{formatAmount(total)} {amountUnit}</strong><small>{form.roll_count} {physicalLabel}{Number(form.roll_count) === 1 ? "" : "s"} × {formatAmount(form.amount)} {amountUnit} each</small></div>
            <ReviewCard title="Material" onEdit={() => navigate(1)} rows={[
              ["Category", form.category === "finished" ? "Finished raw material" : `Raw component · ${COMPONENTS.find(([value]) => value === form.material_type)?.[1]}`],
              ["Material", materialName], form.definitionMode === "new" && ["Catalog", "New material will be created"],
              form.definitionMode === "new" && form.category === "finished" && ["Family", form.master_type === "__new__" ? `${form.master_type_code} (new)` : selectedMaster?.code],
            ]} />
            <ReviewCard title="Source" onEdit={() => navigate(2)} rows={[["Source", ORIGINS.find(([value]) => value === form.inventory_origin)?.[1]], ["Supplier", selectedSupplier?.name], ["Received", form.received_date]]} />
            <ReviewCard title="Quantity" onEdit={() => navigate(3)} rows={[["Each item", `${formatAmount(form.amount)} ${amountUnit}`], ["Physical items", form.roll_count], needsWidth(form) && ["Width", `${form.width_inches} in`], ["Lot", form.lot_number || "Not provided — can be added later"]]} />
            <ReviewCard title="Storage" onEdit={() => navigate(4)} rows={[["Destination", destination], form.notes.trim() && ["Notes", form.notes]]} />
            {!form.lot_number.trim() && <p className="intake-callout is-warning">No lot number entered. You can add it later from the inventory item.</p>}
            {saveError && <div className="intake-error" id="intake-save-error" role="alert" tabIndex={-1}><strong>Unable to confirm the save</strong><p>{saveError}</p><p>Your entries are still here. You can retry this entry. If you change its details after a connection failure, check inventory first.</p></div>}
          </>}
        </section>}
      </div>
      <footer className="intake-footer">
        {result ? <><span className="intake-hint">Saved to inventory.</span><button className="primary-btn" type="button" onClick={onClose}><Check size={17} /> Done</button></> : discard ? <span className="intake-hint">Keep editing to return to your entry.</span> : <>
          <button className="ghost-btn" type="button" disabled={busy} onClick={step ? () => navigate(step - 1) : requestClose}>{step ? <><ArrowLeft size={16} /> Back</> : "Cancel"}</button>
          <div className="intake-footer-actions"><button className="primary-btn" type="submit" value={step === 5 ? "save" : "continue"} disabled={busy}>
            {busy ? <><LoaderCircle className="intake-spinner" size={17} /> Adding material…</> : step === 5 ? <><PackagePlus size={17} /> Add to inventory</> : <>{step === 4 ? "Review entry" : "Continue"}<ArrowRight size={17} /></>}
          </button></div>
        </>}
      </footer>
    </form>
  </dialog>;
}
