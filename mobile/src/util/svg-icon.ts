// Inline stroke-icon markup in the app's one icon style (currentColor, round
// caps, no fill): the settings sliders' end symbols and the offline lobby's
// device-row icons. `attrs` adds root attributes (stroke-width, linejoin).
export const strokeIcon = (w: number, h: number, body: string, attrs = ''): string =>
  `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" stroke="currentColor"`
  + ` stroke-linecap="round"${attrs}>${body}</svg>`
