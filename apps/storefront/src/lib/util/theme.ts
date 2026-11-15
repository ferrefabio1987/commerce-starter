import type { StoreConfig } from "@store-config"

/**
 * CSS variables for the white-label theme. `--brand-*` feed the Tailwind
 * `brand` tokens; the rest override @medusajs/ui-preset variables so every
 * `ui-*` utility in the upstream components follows the configured palette.
 */
export function themeCss({ colors, fontFamily, radius }: StoreConfig["theme"]) {
  const mix = (color: string, with_: string, pct: number) =>
    `color-mix(in srgb, ${color} ${pct}%, ${with_})`
  const vars: Record<string, string> = {
    "--brand-primary": colors.primary,
    "--brand-primary-hover": mix(colors.primary, colors.background, 85),
    "--brand-primary-fg": colors.primaryForeground,
    "--brand-secondary": colors.secondary,
    "--brand-secondary-hover": mix(colors.secondary, colors.foreground, 92),
    "--brand-secondary-fg": colors.secondaryForeground,
    "--brand-font": fontFamily,
    "--brand-radius": radius,
    "--bg-base": colors.background,
    "--bg-subtle": colors.secondary,
    "--bg-field": colors.background,
    "--fg-base": colors.foreground,
    "--fg-subtle": mix(colors.foreground, colors.muted, 55),
    "--fg-muted": colors.muted,
    "--border-base": colors.border,
    "--button-inverted": colors.primary,
    "--button-inverted-hover": mix(colors.primary, colors.background, 85),
    "--button-inverted-pressed": mix(colors.primary, colors.background, 75),
    "--fg-on-inverted": colors.primaryForeground,
    "--bg-interactive": colors.primary,
    "--fg-interactive": colors.primary,
    "--fg-interactive-hover": mix(colors.primary, colors.foreground, 80),
    "--border-interactive": colors.primary,
  }
  // Doubled :root outranks the ui-preset's :root block regardless of CSS order.
  return `:root:root{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";")}}`
}
