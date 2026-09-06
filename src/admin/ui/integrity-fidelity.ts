export function applyFidelityIntegrity(html: string): string {
  // The existing real client renders six model cells. Keep the visual catalog
  // header aligned with that authoritative row contract after the fidelity pass.
  return html
    .replace(
      '<th style="width:27%">Model</th><th style="width:19%">Provider</th><th style="width:14%">Model policy</th><th style="width:17%">Effective runtime</th><th style="width:23%">Aliases & actions</th>',
      '<th style="width:24%">Model</th><th style="width:17%">Provider</th><th style="width:13%">Model policy</th><th style="width:16%">Effective runtime</th><th style="width:16%">Routing aliases</th><th style="width:14%">Actions</th>',
    )
    .replace('<tbody id="models-body"><tr><td colspan="5">', '<tbody id="models-body"><tr><td colspan="6">');
}
