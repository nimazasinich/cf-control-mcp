import test from "node:test";
import assert from "node:assert/strict";
import { dashboardHtml, loginPageHtml } from "../src/admin/ui";

test("visual acceptance fixture markers never leak into production Admin HTML", () => {
  const dashboard = dashboardHtml();
  const login = loginPageHtml();
  for (const html of [dashboard, login]) {
    assert.ok(!html.includes("VISUAL_ACCEPTANCE_FIXTURE_ONLY"));
    assert.ok(!html.includes("VISUAL QA FIXTURE"));
    assert.ok(!html.includes("VISUAL TEST DATA"));
    assert.ok(!html.includes("__VISUAL_ACCEPTANCE_FIXTURE_ONLY__"));
    assert.ok(!html.includes("data-visual-fixture"));
  }
});
