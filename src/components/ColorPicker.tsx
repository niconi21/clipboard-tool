import { PRESET_COLORS } from "../constants";

interface Props {
  value: string;
  onChange: (color: string) => void;
  size?: "sm" | "md";
}

export function ColorPicker({ value, onChange, size = "md" }: Props) {
  const dotClass = size === "sm" ? "w-4 h-4" : "w-5 h-5";
  return (
    <div className="flex gap-1.5 flex-wrap items-center">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`${dotClass} rounded-full border-2 transition-all ${value === c ? "border-white scale-110" : "border-transparent"}`}
          style={{ backgroundColor: c }}
        />
      ))}
      <label
        title="Custom color"
        className={`${dotClass} rounded-full border-2 cursor-pointer transition-all overflow-hidden ${!PRESET_COLORS.includes(value) ? "border-white scale-110" : "border-transparent"}`}
        style={{ background: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" }}
      >
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="sr-only" />
      </label>
    </div>
  );
}
