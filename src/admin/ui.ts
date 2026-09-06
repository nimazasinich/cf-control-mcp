export { loginPageHtml } from "./ui/login";
import { dashboardHtml as baseDashboardHtml } from "./ui/dashboard";
import { applyModelsFidelity } from "./ui/models-fidelity";

export function dashboardHtml(): string {
	return applyModelsFidelity(baseDashboardHtml());
}
