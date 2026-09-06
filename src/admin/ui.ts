export { loginPageHtml } from "./ui/login";
import { dashboardHtml as baseDashboardHtml } from "./ui/dashboard";
import { applyLoadingFidelity } from "./ui/loading-fidelity";
import { applyModelsFidelity } from "./ui/models-fidelity";
import { applyProvidersFidelity } from "./ui/providers-fidelity";

export function dashboardHtml(): string {
	return applyLoadingFidelity(applyProvidersFidelity(applyModelsFidelity(baseDashboardHtml())));
}
