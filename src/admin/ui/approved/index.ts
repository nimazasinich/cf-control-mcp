/**
 * GENERATED FILE — do not edit by hand.
 * Run: node scripts/generate-approved-pages.mjs
 */
import { OVERVIEW_HTML, OVERVIEW_SHA256 } from "./overview";
import { PROVIDERS_HTML, PROVIDERS_SHA256 } from "./providers";
import { MODELS_HTML, MODELS_SHA256 } from "./models";
import { TOOLS_HTML, TOOLS_SHA256 } from "./tools";
import { ROUTING_HTML, ROUTING_SHA256 } from "./routing";
import { HEALTH_HTML, HEALTH_SHA256 } from "./health";
import { AUDIT_HTML, AUDIT_SHA256 } from "./audit";
import { SETTINGS_HTML, SETTINGS_SHA256 } from "./settings";
import { LOGIN_HTML, LOGIN_SHA256 } from "./login";
import { LOADING_HTML, LOADING_SHA256 } from "./loading";

export { OVERVIEW_HTML, OVERVIEW_SHA256 };
export { PROVIDERS_HTML, PROVIDERS_SHA256 };
export { MODELS_HTML, MODELS_SHA256 };
export { TOOLS_HTML, TOOLS_SHA256 };
export { ROUTING_HTML, ROUTING_SHA256 };
export { HEALTH_HTML, HEALTH_SHA256 };
export { AUDIT_HTML, AUDIT_SHA256 };
export { SETTINGS_HTML, SETTINGS_SHA256 };
export { LOGIN_HTML, LOGIN_SHA256 };
export { LOADING_HTML, LOADING_SHA256 };

export interface ApprovedPage {
  html: string;
  sha256: string;
}

export const APPROVED_PAGES: Record<string, ApprovedPage> = {
  overview: { html: OVERVIEW_HTML, sha256: OVERVIEW_SHA256 },
  providers: { html: PROVIDERS_HTML, sha256: PROVIDERS_SHA256 },
  models: { html: MODELS_HTML, sha256: MODELS_SHA256 },
  tools: { html: TOOLS_HTML, sha256: TOOLS_SHA256 },
  routing: { html: ROUTING_HTML, sha256: ROUTING_SHA256 },
  health: { html: HEALTH_HTML, sha256: HEALTH_SHA256 },
  audit: { html: AUDIT_HTML, sha256: AUDIT_SHA256 },
  settings: { html: SETTINGS_HTML, sha256: SETTINGS_SHA256 },
  login: { html: LOGIN_HTML, sha256: LOGIN_SHA256 },
  loading: { html: LOADING_HTML, sha256: LOADING_SHA256 },
};

export type ApprovedPageName = keyof typeof APPROVED_PAGES;
