import React from 'react';

/**
 * SearchBar
 * Props:
 *   onChange  (e) => void  — debounced handler dari POSContainer
 *   disabled  bool         — dinonaktifkan saat versionMissing
 */
const SearchBar = ({ onChange, disabled }) => {
    return (
        <input
            type="text"
            placeholder="Cari Nama / Barcode..."
            onChange={onChange}
            disabled={disabled}
            style={{
                width: '100%',
                padding: '10px',
                marginBottom: '12px',
                borderRadius: '4px',
                border: '1px solid #ccc',
                boxSizing: 'border-box',
                fontSize: '14px',
                opacity: disabled ? 0.5 : 1,
                cursor: disabled ? 'not-allowed' : 'text',
            }}
        />
    );
};

export default SearchBar;