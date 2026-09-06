export const VISUAL_ACCEPTANCE_FIXES_CSS = String.raw`
/*
 * Exact-viewport defect fixes discovered by deterministic 1368x753 review.
 * These are narrow presentation corrections only; no backend/runtime contract changes.
 */

/* Overview: remove the 1-2px content rounding overflow detected by the exact viewport audit. */
#page-overview .overview-fidelity-grid{height:calc(100% - 188px)}

/* Models: preserve six-column renderer density while keeping the action cell fully usable. */
#page-models .model-catalog-table .data-table th:nth-child(1),
#page-models .model-catalog-table .data-table td:nth-child(1){width:22%!important}
#page-models .model-catalog-table .data-table th:nth-child(2),
#page-models .model-catalog-table .data-table td:nth-child(2){width:16%!important}
#page-models .model-catalog-table .data-table th:nth-child(3),
#page-models .model-catalog-table .data-table td:nth-child(3){width:12%!important}
#page-models .model-catalog-table .data-table th:nth-child(4),
#page-models .model-catalog-table .data-table td:nth-child(4){width:15%!important}
#page-models .model-catalog-table .data-table th:nth-child(5),
#page-models .model-catalog-table .data-table td:nth-child(5){width:15%!important}
#page-models .model-catalog-table .data-table th:nth-child(6),
#page-models .model-catalog-table .data-table td:nth-child(6){width:20%!important}
#page-models .model-catalog-table .data-table td{min-width:0}
#page-models .model-catalog-table .row-actions{display:flex;flex-wrap:nowrap;gap:3px;min-width:0}
#page-models .model-catalog-table .row-actions .btn{height:23px;padding:0 5px;font-size:6.6px;min-width:0;white-space:nowrap}
#page-models .model-inspector-card,
#page-models .model-inspector-body,
#page-models .model-inspector-section,
#page-models .model-inspector-facts,
#page-models .model-inspector-fact{min-width:0}
#page-models .model-inspector-facts{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
#page-models .model-inspector-fact b{max-width:100%}
#page-models .model-inspector-aliases .chip{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Routing: long target/provider values must stay inside the persistent inspector. */
#page-routing .routing-inspector-wrap,
#page-routing .routing-inspector-wrap #route-inspector,
#page-routing .routing-inspector-wrap #route-inspector .facts,
#page-routing .routing-inspector-wrap #route-inspector .fact{min-width:0}
#page-routing .routing-inspector-wrap #route-inspector .facts{grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important}
#page-routing .routing-inspector-wrap #route-inspector .fact b{max-width:100%!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
#page-routing .routing-inspector-wrap #route-inspector h2{max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* Health: diagnostic identity/evidence must truncate or wrap inside the inspector, never clip it. */
#page-health .health-diagnostic-card,
#page-health .health-diagnostic-body,
#page-health .health-diagnostic-facts,
#page-health .health-diagnostic-fact{min-width:0}
#page-health .health-diagnostic-fact b{display:block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#page-health .health-diagnostic-state>div{min-width:0}
#page-health .health-diagnostic-state b{display:block;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#page-health .health-diagnostic-state span,
#page-health .health-diagnostic-copy{overflow-wrap:anywhere}

/* Loading: the nine authoritative bootstrap sources must all be visible at 1368x753. */
.bootstrap-fidelity .boot-grid.boot-grid-fidelity{max-height:none;height:112px;grid-template-rows:repeat(3,34px);overflow:hidden}
.bootstrap-fidelity .boot-grid-fidelity .boot-step{height:34px!important;min-height:34px!important;padding:5px 7px!important}
.bootstrap-fidelity .boot-grid-fidelity .boot-step b{line-height:1.05}
.bootstrap-fidelity .boot-grid-fidelity .boot-step span{line-height:1.15}
`;

export function applyVisualAcceptanceFixes(html: string): string {
  return html.replace("</head>", "<style>" + VISUAL_ACCEPTANCE_FIXES_CSS + "</style></head>");
}
