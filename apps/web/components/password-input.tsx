"use client";

import { useState } from "react";

type PasswordInputProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
  placeholder?: string;
  ariaLabel?: string;
};

export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  minLength,
  required = false,
  placeholder,
  ariaLabel,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-input-wrap">
      <input
        id={id}
        className="input password-input"
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="password-visibility-toggle"
        aria-label={visible ? "Сховати пароль" : "Показати пароль"}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 3l18 18M10.6 10.6A2 2 0 0013.4 13.4M9.9 4.3A10.5 10.5 0 0112 4c5.5 0 9 5 9 8a11.8 11.8 0 01-2.2 3.7M6.2 6.2C4.2 7.7 3 10 3 12c0 3 3.5 8 9 8 1.6 0 3-.4 4.2-1.1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 12c0-3 3.5-8 9-8s9 5 9 8-3.5 8-9 8-9-5-9-8z" />
            <circle cx="12" cy="12" r="2.6" />
          </svg>
        )}
      </button>
    </div>
  );
}
