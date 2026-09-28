"use client";

import { TimeSelect24 } from "./time-select-24";

type DateTimeFields24Props = {
  date: string;
  time: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  dateLabel?: string;
  timeLabel?: string;
  required?: boolean;
  disabled?: boolean;
  minDate?: string;
  stepMinutes?: number;
  idPrefix: string;
};

export function DateTimeFields24({
  date,
  time,
  onDateChange,
  onTimeChange,
  dateLabel = "Дата",
  timeLabel = "Час",
  required = false,
  disabled = false,
  minDate,
  stepMinutes = 30,
  idPrefix,
}: DateTimeFields24Props) {
  return (
    <div className="date-time-fields-24">
      <div className="field">
        <label htmlFor={`${idPrefix}-date`}>{dateLabel}</label>
        <input
          id={`${idPrefix}-date`}
          className="input"
          type="date"
          min={minDate}
          required={required}
          disabled={disabled}
          value={date}
          onChange={(event) => onDateChange(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-time`}>{timeLabel}</label>
        <TimeSelect24
          id={`${idPrefix}-time`}
          value={time}
          onChange={onTimeChange}
          stepMinutes={stepMinutes}
          required={required}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
