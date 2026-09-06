export { loginPageHtml } from "./ui/login";
import { dashboardHtml as baseDashboardHtml } from "./ui/dashboard";
import { applyAuditFidelity } from "./ui/audit-fidelity";
import { applyHealthFidelity } from "./ui/health-fidelity";
import { applyLoadingFidelity } from "./ui/loading-fidelity";
import { applyModelsFidelity } from "./ui/models-fidelity";
import { applyProvidersFidelity } from "./ui/providers-fidelity";

export function dashboardHtml(): string {
	return applyAuditFidelity(applyHealthFidelity(applyLoadingFidelity(applyProvidersFidelity(applyModelsFidelity(baseDashboardHtml())))));
}
