import React, { useState, useRef, useEffect, useMemo } from 'react';
import { CaretDown } from '@phosphor-icons/react';

const SearchableSelect = ({
    options,
    value,
    onChange,
    placeholder = "-- Select --",
    required = false,
    name = "",
    className = "input-shell",
    disabled = false
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState("");
    const wrapperRef = useRef(null);

    // Find current selected option label
    const selectedOption = useMemo(() => options.find(opt => String(opt.value) === String(value)), [options, value]);

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Filter options based on search
    const filteredOptions = useMemo(() => {
        if (!search.trim()) return options;
        const lowerSearch = search.toLowerCase();
        return options.filter(opt =>
            opt.label.toLowerCase().includes(lowerSearch)
        );
    }, [options, search]);

    const handleSelect = (optionValue) => {
        onChange({ target: { name, value: optionValue } });
        setIsOpen(false);
        setSearch(""); // Reset search on select
    };

    return (
        <div ref={wrapperRef} className="relative w-full">
            {/* Hidden native select for form validation/required support if needed */}
            <select
                className="hidden"
                value={value}
                name={name}
                onChange={() => {}}
                required={required}
                disabled={disabled}
            >
                <option value="">{placeholder}</option>
                {options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>

            <button
                type="button"
                className={`${className} flex items-center justify-between text-left w-full ${!selectedOption ? 'text-[var(--text-3)]' : ''}`}
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
            >
                <span className="truncate pr-2">
                    {selectedOption ? selectedOption.label : placeholder}
                </span>
                <span className="opacity-60"><CaretDown size={12} weight="regular" /></span>
            </button>

            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-[var(--surface)] border border-[var(--line)] rounded-lg shadow-xl overflow-hidden flex flex-col">
                    <div className="p-2 border-b border-[var(--line)] bg-[var(--surface-2)]">
                        <input
                            type="text"
                            className="w-full bg-[var(--surface)] border border-[var(--line)] rounded-md px-3 py-1.5 text-sm outline-none focus:border-[var(--text-1)]"
                            placeholder="Type to search..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                        />
                    </div>

                    <div className="max-h-60 overflow-y-auto soft-scroll">
                        {!required && (
                            <button
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)] transition-colors"
                                onClick={() => handleSelect("")}
                            >
                                {placeholder}
                            </button>
                        )}
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((opt) => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                                        String(opt.value) === String(value)
                                            ? 'bg-[var(--surface-2)] text-[var(--text-1)] font-medium'
                                            : 'hover:bg-[var(--surface-2)] text-[var(--text-1)]'
                                    }`}
                                    onClick={() => handleSelect(opt.value)}
                                >
                                    {opt.label}
                                </button>
                            ))
                        ) : (
                            <div className="px-3 py-3 text-sm text-[var(--text-3)] text-center">
                                No matching results
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SearchableSelect;
