import { useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { findById, sameId } from "../intakeWorkflow";

// A selection must come from the list; typed search text is never a saved ID.
export default function IntakeSearchPicker({ id, label, options, value, onChange, getLabel, placeholder, error, optional = false }) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const listId = `${inputId}-options`;
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = findById(options, value);
  const matches = options.filter((option) => getLabel(option).toLowerCase().includes(query.trim().toLowerCase()));
  const visible = matches.slice(0, 40);
  const active = Math.min(activeIndex, visible.length - 1);

  function choose(option) {
    onChange(String(option.id));
    setQuery("");
    setOpen(false);
  }

  function moveActive(index) {
    setActiveIndex(index);
    document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className="intake-field intake-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <label htmlFor={inputId}>{label}{optional && <span className="intake-hint"> (optional)</span>}</label>
      <div className="intake-picker-control">
        <Search size={17} aria-hidden="true" />
        <input ref={inputRef} id={inputId} role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
          aria-activedescendant={open && visible[active] ? `${listId}-${active}` : undefined}
          aria-required={!optional} aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined}
          value={open ? query : selected ? getLabel(selected) : query} placeholder={placeholder}
          onFocus={() => { setQuery(""); setActiveIndex(0); setOpen(true); }}
          onClick={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); if (value) onChange(""); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); setOpen(true);
              moveActive(event.key === "ArrowDown" ? (open ? Math.min(active + 1, visible.length - 1) : 0) : Math.max(active - 1, 0));
            } else if (event.key === "Enter" && open) {
              event.preventDefault(); if (visible[active]) choose(visible[active]);
            } else if (event.key === "Escape" && open) {
              event.preventDefault(); event.stopPropagation(); setOpen(false);
            }
          }} />
        {(value || query) && <button type="button" aria-label={`Clear ${label}`} onClick={() => { onChange(""); setQuery(""); setActiveIndex(0); inputRef.current?.focus(); setOpen(true); }}><X size={16} /></button>}
      </div>
      {open && <div id={listId} className="intake-picker-options" role="listbox" aria-label={label}>
        {visible.map((option, index) => <div id={`${listId}-${index}`} key={option.id} role="option" aria-selected={sameId(option.id, value)}
          className={`intake-picker-option ${index === active ? "is-active" : ""} ${sameId(option.id, value) ? "is-selected" : ""}`}
          onPointerDown={(event) => event.preventDefault()} onClick={() => choose(option)}>{getLabel(option)}</div>)}
        {!visible.length && <p className="intake-empty">{options.length ? "No matches. Try another name or code." : "No active options are available."}</p>}
        {matches.length > 40 && <p className="intake-hint">Showing 40 of {matches.length}. Type more to narrow the results.</p>}
      </div>}
      {error && <span id={`${inputId}-error`} className="intake-field-error">{error}</span>}
    </div>
  );
}
