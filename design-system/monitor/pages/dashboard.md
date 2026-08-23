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
5. Borders are only a 5.5% white edge cue. Depth comes primarily from blur, absorption,
   a one-pixel top highlight and neutral shadow—not a bright outline.

## Light material model

- Keep the existing low-white clear-glass direction; never replace it with opaque white cards.
- Pair the same radii, spacing, shadows, focus states and hierarchy with the dark theme.

## Accessibility and responsive rules

- Normal text must retain at least 4.5:1 contrast against its composed surface.
- Every interactive control has a visible 2px focus indicator.
- Mobile controls use at least 44px height where space permits; body text is 16px.
- Validate at 375/390, 768, 1024 and 1440px without horizontal overflow.
- Respect `prefers-reduced-motion` and do not depend on hover to expose information.
