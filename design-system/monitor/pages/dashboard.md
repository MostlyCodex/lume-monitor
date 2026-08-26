# 远山 Monitor — Dashboard Override

This file overrides `../MASTER.md` for the production dashboard. It records the
project-specific interpretation of the generated glassmorphism direction.

## Non-negotiable product constraints

- Preserve the existing information architecture, telemetry, labels and interactions.
- Keep the dashboard dependency-light: no remote fonts, icon libraries or decorative scripts.
- Use neutral smoked glass. Do not introduce blue card fills or opaque charcoal panels.
- Never use elevation transforms on node-card hover.
- Keep all operational state colors semantic and unchanged in meaning.

## Dark material model

1. The alpine environment is dimmed before any glass is composited:
   `brightness(68%) contrast(106%) saturate(78%)` plus an 18% neutral-black scrim.
2. Primary glass uses a transparent-black absorption layer (`rgba(7, 8, 10, .22)`).
3. Node glass is slightly clearer (`rgba(5, 6, 8, .18)`) so the background remains perceptible.
4. Backdrop blur is 16px with reduced saturation and 84% brightness. The material must
   look like smoked glass, not a gray rectangle or a white haze.
5. Large glass surfaces use one low-opacity edge cue only: 3.5% white in dark mode and
   5.5% white in light mode. Do not combine that edge with an inset highlight; depth comes
   from blur, absorption and a soft external shadow.

## Light material model

- Keep the existing low-white clear-glass direction; never replace it with opaque white cards.
- Pair the same radii, spacing, shadows, focus states and hierarchy with the dark theme.

## Accessibility and responsive rules

- Normal text must retain at least 4.5:1 contrast against its composed surface.
- Every interactive control has a visible focus indicator. Node cards use a title underline
  instead of an outer focus ring so mouse selection never resembles a persistent card border.
- Mobile controls use at least 44px height where space permits; body text is 16px.
- Validate at 375/390, 768, 1024 and 1440px without horizontal overflow.
- Respect `prefers-reduced-motion` and do not depend on hover to expose information.
- Node-card hover, click and restored focus never recolor the card edge; operational severity
  remains visible through the status pill and telemetry colors.

## Full-bleed page chrome

- The top command bar material spans the complete viewport width while its controls retain
  bounded, responsive inner gutters. It touches every top and side edge with square corners.
- The dashboard footer is a full-width smoked-glass closing band with a 112px desktop and
  96px mobile minimum height. Footer content remains aligned to the main content column.
- Top and bottom chrome have no border lines or inset highlights. The footer is more
  transparent than the top bar and fades its blur in over 38px for a soft content transition.
- Full-bleed surfaces must never increase the document scroll width or introduce a horizontal
  scrollbar at 375, 390, 768, 1024 or 1440px.

## Detail performance and hierarchy

- CPU, RAM and disk stay on the fleet cards and are not duplicated in node details.
- A node detail opens immediately from already-loaded fleet history for 6-hour and 24-hour
  views. The 1-minute
  detail series replaces that preview in the background and remains cached for the session.
- Do not prefetch every node: perceived speed must not increase D1 reads or transfer volume.
