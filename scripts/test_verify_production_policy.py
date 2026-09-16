import unittest
from verify_production import _provider_requirements, _routing_invariants

class ProductionPolicyTests(unittest.TestCase):
    def test_workers_ai_only_does_not_require_google_byok_or_cf_aig_token(self):
        providers = [
            {"id":"workers-ai","enabled":1,"transport":"workers-ai-binding","credential_required":0,"byok_alias":None},
            {"id":"google-ai-studio","enabled":0,"transport":"gateway-native","credential_required":1,"byok_alias":"default"},
        ]
        direct_aig, google_byok = _provider_requirements(providers)
        self.assertFalse(direct_aig)
        self.assertFalse(google_byok)

    def test_enabled_gateway_native_provider_requires_authenticated_gateway(self):
        providers = [
            {"id":"google-ai-studio","enabled":1,"transport":"gateway-native","credential_required":1,"byok_alias":"default"},
        ]
        direct_aig, google_byok = _provider_requirements(providers)
        self.assertTrue(direct_aig)
        self.assertTrue(google_byok)

    def test_routing_accepts_enabled_workers_ai_targets(self):
        enabled_models={"@cf/zai-org/glm-4.7-flash","@cf/nvidia/nemotron-3-120b-a12b","@cf/google/gemma-4-26b-a4b-it"}
        routes={"fast":"@cf/zai-org/glm-4.7-flash","coding":"@cf/nvidia/nemotron-3-120b-a12b","research":"@cf/google/gemma-4-26b-a4b-it"}
        self.assertTrue(_routing_invariants(routes, enabled_models, set(enabled_models)))

if __name__ == "__main__":
    unittest.main()
