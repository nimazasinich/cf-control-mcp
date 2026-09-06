export { loginPageHtml } from "./ui/login";
import { dashboardHtml as baseDashboardHtml } from "./ui/dashboard";
import { applyModelsFidelity } from "./ui/models-fidelity";
import { applyProvidersFidelity } from "./ui/providers-fidelity";

export function dashboardHtml(): string {
	return applyProvidersFidelity(applyModelsFidelity(baseDashboardHtml()));
}
