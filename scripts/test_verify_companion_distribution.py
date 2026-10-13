import unittest

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

spec = spec_from_file_location("distribution", Path(__file__).with_name("verify-companion-distribution.py"))
distribution = module_from_spec(spec)
spec.loader.exec_module(distribution)


class DistributionTest(unittest.TestCase):
    def test_rejects_wrong_identity_version_and_development_export(self):
        info = {"CFBundleIdentifier": "dev.monocode.companion", "CFBundleShortVersionString": "0.1.1", "CFBundleVersion": "1001"}
        profile = {"TeamIdentifier": ["TEAM123456"], "Entitlements": {"application-identifier": "TEAM123456.dev.monocode.companion", "get-task-allow": False}}
        options = dict(team="TEAM123456", version="0.1.1", build="1001")
        self.assertEqual(distribution.validate_ios_distribution(info, profile, **options), [])
        self.assertTrue(distribution.validate_ios_distribution(info, profile, **{**options, "team": "OTHERTEAM1"}))
        self.assertTrue(distribution.validate_ios_distribution(info, profile, **{**options, "build": "1002"}))
        self.assertTrue(distribution.validate_ios_distribution(info, {**profile, "ProvisionedDevices": []}, **options))
        self.assertTrue(distribution.validate_ios_distribution(info, {**profile, "Entitlements": {}}, **options))
