"use client";

type TimeSelect24Props = {
  value: string;
  onChange: (value: string) => void;
  stepMinutes?: number;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  ariaLabel?: string;
  className?: string;
};

function buildTimeOptions(stepMinutes: number, currentValue: string) {
  const values: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) {
    const hours = Math.floor(minutes / 60).toString().padStart(2, "0");
    const mins = (minutes % 60).toString().padStart(2, "0");
    values.push(`${hours}:${mins}`);
  }

  if (/^\d{2}:\d{2}$/.test(currentValue) && !values.includes(currentValue)) {
    values.push(currentValue);
    values.sort();
  }

  return values;
}

export function TimeSelect24({
  value,
  onChange,
  stepMinutes = 30,
  required = false,
  disabled = false,
  id,
  name,
  ariaLabel,
  className = "select",
}: TimeSelect24Props) {
  const options = buildTimeOptions(stepMinutes, value);

  return (
    <select
      id={id}
      name={name}
      aria-label={ariaLabel}
      className={`${className} time-select-24`}
      value={value}
      required={required}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" disabled={required}>{required ? "Оберіть час" : "—"}</option>
      {options.map((time) => <option key={time} value={time}>{time}</option>)}
    </select>
  );
}
