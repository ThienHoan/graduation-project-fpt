"use client";

import { useMemo } from "react";
import { Check, X } from "lucide-react";

export type PasswordStrengthRule = {
  id: string;
  label: string;
  test: (val: string) => boolean;
};

export const PASSWORD_RULES: PasswordStrengthRule[] = [
  { id: "length", label: "Tối thiểu 8 ký tự", test: (v) => v.length >= 8 },
  { id: "upper", label: "Có chữ in hoa (A-Z)", test: (v) => /[A-Z]/.test(v) },
  { id: "lower", label: "Có chữ in thường (a-z)", test: (v) => /[a-z]/.test(v) },
  { id: "number", label: "Có chữ số (0-9)", test: (v) => /\d/.test(v) },
  { id: "special", label: "Có ký tự đặc biệt (@, #, $, ...)", test: (v) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(v) },
];

export interface PasswordStrengthIndicatorProps {
  value: string;
  showRules?: boolean;
  className?: string;
}

export function PasswordStrengthIndicator({
  value,
  showRules = true,
  className = "",
}: PasswordStrengthIndicatorProps) {
  const { score, level, colorClass, widthPercent } = useMemo(() => {
    if (!value) {
      return { score: 0, level: "Chưa nhập", colorClass: "bg-slate-200", widthPercent: "w-0" };
    }

    let passCount = 0;
    for (const rule of PASSWORD_RULES) {
      if (rule.test(value)) passCount++;
    }

    if (passCount <= 2) {
      return { score: passCount, level: "Yếu", colorClass: "bg-red-500", widthPercent: "w-1/3" };
    }
    if (passCount <= 4) {
      return { score: passCount, level: "Trung bình", colorClass: "bg-amber-500", widthPercent: "w-2/3" };
    }
    return { score: passCount, level: "Mạnh", colorClass: "bg-emerald-500", widthPercent: "w-full" };
  }, [value]);

  if (!value) return null;

  return (
    <div className={`space-y-2 pt-1 ${className}`}>
      {/* Strength Bar */}
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${colorClass} ${widthPercent}`}
            data-testid="strength-bar"
          />
        </div>
        <span
          className="text-xs font-semibold text-ink/70"
          data-testid="strength-level"
        >
          {level}
        </span>
      </div>

      {/* Rules Checklist */}
      {showRules && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 pt-1 text-xs text-ink/80">
          {PASSWORD_RULES.map((rule) => {
            const passed = rule.test(value);
            return (
              <li
                key={rule.id}
                className={`flex items-center gap-1.5 transition-colors ${
                  passed ? "text-emerald-700 font-medium" : "text-slate-400"
                }`}
                data-testid={`rule-${rule.id}`}
              >
                {passed ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                ) : (
                  <X className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                )}
                <span>{rule.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

