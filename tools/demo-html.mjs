/** Reuse the compiled app at either /demo/ or a GitHub Pages project subpath. */
export function demoHtml(source, assetPrefix = "../dashboard/") {
  return source
    .replace('data-theme="dark"', 'data-theme="dark" data-demo="true"')
    .replace(
      "Private, lightweight VPS observability dashboard.",
      "体验 Lume：浏览虚构 VPS 的资源、线路质量与历史图表。",
    )
    .replaceAll('"./assets/', `"${assetPrefix}assets/`);
}
