export { loginPageHtml } from "./ui/login";
import { dashboardHtml as baseDashboardHtml } from "./ui/dashboard";
import { applyAuditFidelity } from "./ui/audit-fidelity";
import { applyHealthFidelity } from "./ui/health-fidelity";
import { applyFidelityIntegrity } from "./ui/integrity-fidelity";
import { applyLoadingFidelity } from "./ui/loading-fidelity";
import { applyModelsFidelity } from "./ui/models-fidelity";
import { applyOverviewFidelity } from "./ui/overview-fidelity";
import { applyProvidersFidelity } from "./ui/providers-fidelity";
import { applyRoutingFidelity } from "./ui/routing-fidelity";
import { applySettingsFidelity } from "./ui/settings-fidelity";
import { applyToolsFidelity } from "./ui/tools-fidelity";
import { applyUsageFidelity } from "./ui/usage-fidelity";

export function dashboardHtml(): string {
	return applyFidelityIntegrity(applyOverviewFidelity(applyToolsFidelity(applyRoutingFidelity(applyUsageFidelity(applySettingsFidelity(applyAuditFidelity(applyHealthFidelity(applyLoadingFidelity(applyProvidersFidelity(applyModelsFidelity(baseDashboardHtml())))))))))));
}
