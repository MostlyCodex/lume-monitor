# Lume — Dashboard Override

This file overrides `../MASTER.md` for the production dashboard. It records the
project-specific interpretation of the generated glassmorphism direction.

## Non-negotiable product constraints

- Preserve the existing information architecture, telemetry, labels and interactions.
- Keep the dashboard dependency-light: no remote fonts, icon libraries or decorative scripts.
- Use neutral smoked glass. Do not introduce blue card fills or opaque charcoal panels.
- Never use elevation transforms on node-card hover.
- Keep all operational state colors semantic and unchanged in meaning.

## Glass material model

- Apply scene tint once, then use neutral translucent fills and 12px backdrop blur
  (10px for compact controls). Avoid stacked brightness filters that make glass opaque.
- Dark mode uses a 56% scene brightness, a 14% black scrim and 10–14% black surface
  tint. Light mode retains more background color with a 16% white scrim and 2–2.5%
  white surface tint. Keep these values centralized in `styles/theme.css`.
- Use one subtle edge and a soft external shadow; do not add inset panels inside fleet cards.
- Pair transparent surfaces with brighter secondary text in dark mode and darker text
  in light mode. Check the composed result with the bundled background on desktop and phones.
- The layering approach references [Fluent Acrylic](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic);
  it is implemented with local CSS, without a design-system runtime.

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
- The dashboard footer is a full-width, text-free smoked-glass closing band with a 112px
  desktop and 96px mobile minimum height.
- Top and bottom chrome have no border lines or inset highlights. The footer is more
  transparent than the top bar and fades its blur in over 38px for a soft content transition.
- Full-bleed surfaces must never increase the document scroll width or introduce a horizontal
  scrollbar at 375, 390, 768, 1024 or 1440px.

## Detail performance and hierarchy

- Fleet cards use one glass surface. Resource gauges, transfer totals and probe rows
  share its gutters; separators provide grouping without inset panels or metric tiles.
- Compact cards through spacing and aligned probe columns. Keep node titles at 16px
  or larger on phones, probe values at 13px or larger, and long target names readable.
- CPU, RAM and disk utilization stay on the fleet cards. Node facts show vCPU count,
  total memory and root filesystem capacity in a compact responsive definition list.
- Node facts start with operating system and kernel, then hardware capacity, hostname
  and Agent health. Transfer rates and totals belong to the fleet cards.
- All detail sections place their headings above the glass surface, including node
  facts and events; use the same heading scale and spacing throughout.
- Missing service reports use a neutral empty state and never imply Agent or service
  health. Overall node status reflects report freshness and configured checks.
- Facts reflow into multiple columns where space permits, wrap long values, and size
  independently of the neighboring events card.
- A node detail opens immediately from already-loaded fleet history for 6-hour and 24-hour
  views. The 1-minute
  detail series replaces that preview in the background and remains cached for the session.
- Do not prefetch every node: perceived speed must not increase D1 reads or transfer volume.

## Charts and events

- Vue-ECharts owns chart updates, resizing, pointers and disposal. Load only the required
  ECharts modules when details open; do not introduce CDN dependencies or custom canvas plugins.
- Preserve missing values as gaps. Failure marks remain visible when latency is unavailable.
- ICMP loss and TCP connection failures use distinct text in tooltips, rendered by Vue.
- Hide the line/sample-count summary beside the history heading. Probe selection already
  indicates which lines are displayed.
- Show the newest five events in the selected range, sorted by timestamp. Refreshing replaces
  older entries in the visible list; it does not delete server history.
