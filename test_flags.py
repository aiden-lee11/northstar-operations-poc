import threading
import unittest
import uuid
from datetime import datetime

from flags import ConflictError, FlagStore


class FlagStoreTests(unittest.TestCase):
    def setUp(self):
        self.store = FlagStore()
        self.key = "new_checkout_flow"

    def test_seeds_six_complete_flags_in_each_environment(self):
        required = {
            "key",
            "name",
            "description",
            "owner",
            "risk",
            "environment",
            "enabled",
            "rollout_percent",
            "version",
            "updated_at",
            "updated_by",
        }
        keys = None
        for environment in ("development", "staging", "production"):
            flags = self.store.list_flags(environment)
            self.assertEqual(6, len(flags))
            environment_keys = {flag["key"] for flag in flags}
            self.assertEqual(6, len(environment_keys))
            if keys is None:
                keys = environment_keys
            else:
                self.assertEqual(keys, environment_keys)
            for flag in flags:
                self.assertEqual(required, set(flag))
                self.assertEqual(environment, flag["environment"])
                self.assertIn(flag["risk"], {"low", "medium", "high"})
                self.assertIs(type(flag["enabled"]), bool)
                self.assertIs(type(flag["rollout_percent"]), int)
                self.assertGreaterEqual(flag["rollout_percent"], 0)
                self.assertLessEqual(flag["rollout_percent"], 100)
                self.assertEqual(1, flag["version"])
                parsed = datetime.fromisoformat(flag["updated_at"])
                self.assertIsNotNone(parsed.tzinfo)
                self.assertTrue(flag["updated_by"])
        self.assertEqual(self.store.list_flags(), self.store.list_flags("staging"))

    def test_environment_isolation_and_missing_keys(self):
        development_before = self.store.get_flag(self.key, "development")
        staging_before = self.store.get_flag(self.key, "staging")
        production_before = self.store.get_flag(self.key, "production")
        changed = self.store.update_flag(
            self.key,
            "development",
            enabled=not development_before["enabled"],
            rollout_percent=17,
            reason="Exercise development environment",
            expected_version=1,
        )
        self.assertEqual(2, changed["version"])
        self.assertEqual(staging_before, self.store.get_flag(self.key, "staging"))
        self.assertEqual(production_before, self.store.get_flag(self.key, "production"))
        self.assertEqual(1, len(self.store.list_audit("development")))
        self.assertEqual([], self.store.list_audit("staging"))
        self.assertEqual([], self.store.list_audit("production"))
        with self.assertRaises(KeyError):
            self.store.get_flag("missing_flag")
        with self.assertRaises(KeyError):
            self.store.update_flag(
                "missing_flag",
                "staging",
                enabled=False,
                rollout_percent=10,
                reason="Attempt missing flag update",
                expected_version=1,
            )

    def test_environment_validation(self):
        operations = (
            lambda value: self.store.list_flags(value),
            lambda value: self.store.get_flag(self.key, value),
            lambda value: self.store.list_audit(value),
            lambda value: self.store.update_flag(
                self.key,
                value,
                enabled=False,
                rollout_percent=10,
                reason="Validate invalid environment",
                expected_version=1,
            ),
            lambda value: self.store.rollback_flag(
                self.key,
                value,
                reason="Validate invalid environment",
                expected_version=1,
            ),
        )
        for invalid in ("Development", "qa", "", None, 1):
            for operation in operations:
                with self.subTest(invalid=invalid, operation=operation):
                    with self.assertRaises(ValueError):
                        operation(invalid)
        self.assertEqual([], self.store.list_audit())
        self.assertEqual(1, self.store.get_flag(self.key)["version"])

    def test_strict_update_validation_never_mutates(self):
        base = {
            "enabled": False,
            "rollout_percent": 20,
            "reason": "A sufficiently detailed reason",
            "expected_version": 1,
            "actor": "Operator",
        }
        invalid_cases = (
            ("enabled", 1),
            ("enabled", None),
            ("rollout_percent", True),
            ("rollout_percent", 10.0),
            ("rollout_percent", -1),
            ("rollout_percent", 101),
            ("expected_version", True),
            ("expected_version", 1.0),
            ("actor", None),
            ("actor", ""),
            ("actor", "   "),
            ("actor", "a" * 101),
        )
        original = self.store.get_flag(self.key)
        for field, value in invalid_cases:
            arguments = dict(base)
            arguments[field] = value
            with self.subTest(field=field, value=value):
                with self.assertRaises(ValueError):
                    self.store.update_flag(self.key, "staging", **arguments)
                self.assertEqual(original, self.store.get_flag(self.key))
                self.assertEqual([], self.store.list_audit())

    def test_reason_normalization_and_validation(self):
        for reason in (None, 42, "", "       ", "1234567", " " + "x" * 501 + " "):
            with self.subTest(reason=reason):
                with self.assertRaises(ValueError):
                    self.store.update_flag(
                        self.key,
                        "staging",
                        enabled=False,
                        rollout_percent=20,
                        reason=reason,
                        expected_version=1,
                    )
        result = self.store.update_flag(
            self.key,
            "staging",
            enabled=False,
            rollout_percent=20,
            reason="   Eight ok   ",
            expected_version=1,
            actor="  Release operator  ",
        )
        event = self.store.list_audit()[0]
        self.assertEqual("Eight ok", event["reason"])
        self.assertEqual("Release operator", event["actor"])
        self.assertEqual("Release operator", result["updated_by"])
        self.assertEqual(1, len(self.store.list_audit()))

    def test_production_requires_exact_key_confirmation_for_change_and_rollback(self):
        original = self.store.get_flag(self.key, "production")
        for confirmation in ("", "wrong", self.key.upper(), None):
            with self.subTest(confirmation=confirmation):
                with self.assertRaises(ValueError):
                    self.store.update_flag(
                        self.key,
                        "production",
                        enabled=True,
                        rollout_percent=10,
                        reason="Enable a production release",
                        expected_version=1,
                        confirmation=confirmation,
                    )
                self.assertEqual(original, self.store.get_flag(self.key, "production"))
                self.assertEqual([], self.store.list_audit("production"))
        updated = self.store.update_flag(
            self.key,
            "production",
            enabled=True,
            rollout_percent=10,
            reason="Enable a production release",
            expected_version=1,
            confirmation=self.key,
        )
        with self.assertRaises(ValueError):
            self.store.rollback_flag(
                self.key,
                "production",
                reason="Undo the production release",
                expected_version=updated["version"],
            )
        self.assertEqual(updated, self.store.get_flag(self.key, "production"))
        rolled_back = self.store.rollback_flag(
            self.key,
            "production",
            reason="Undo the production release",
            expected_version=updated["version"],
            confirmation=self.key,
        )
        self.assertEqual(original["enabled"], rolled_back["enabled"])
        self.assertEqual(original["rollout_percent"], rolled_back["rollout_percent"])

    def test_optimistic_concurrency_rejects_stale_requests_without_mutation(self):
        updated = self.store.update_flag(
            self.key,
            "staging",
            enabled=False,
            rollout_percent=25,
            reason="First valid staged update",
            expected_version=1,
        )
        with self.assertRaises(ConflictError):
            self.store.update_flag(
                self.key,
                "staging",
                enabled=True,
                rollout_percent=80,
                reason="This version is now stale",
                expected_version=1,
            )
        with self.assertRaises(ConflictError):
            self.store.rollback_flag(
                self.key,
                "staging",
                reason="This rollback is now stale",
                expected_version=1,
            )
        self.assertIsInstance(ConflictError("stale"), ValueError)
        self.assertEqual(updated, self.store.get_flag(self.key))
        self.assertEqual(1, len(self.store.list_audit()))

    def test_concurrent_expected_version_has_one_winner(self):
        count = 8
        barrier = threading.Barrier(count)
        results = []
        result_lock = threading.Lock()

        def update(rollout_percent):
            barrier.wait()
            try:
                self.store.update_flag(
                    self.key,
                    "staging",
                    enabled=False,
                    rollout_percent=rollout_percent,
                    reason="Concurrent staged flag update",
                    expected_version=1,
                )
                outcome = "updated"
            except ConflictError:
                outcome = "conflict"
            with result_lock:
                results.append(outcome)

        threads = [threading.Thread(target=update, args=(number,)) for number in range(1, count + 1)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(1, results.count("updated"))
        self.assertEqual(count - 1, results.count("conflict"))
        self.assertEqual(2, self.store.get_flag(self.key)["version"])
        self.assertEqual(1, len(self.store.list_audit()))

    def test_audit_contents_order_and_deep_copy_immutability(self):
        original = self.store.get_flag(self.key)
        first = self.store.update_flag(
            self.key,
            "staging",
            enabled=False,
            rollout_percent=25,
            reason="First staged rollout change",
            expected_version=1,
            actor="Operator one",
        )
        second = self.store.update_flag(
            self.key,
            "staging",
            enabled=True,
            rollout_percent=75,
            reason="Second staged rollout change",
            expected_version=2,
            actor="Operator two",
        )
        audit = self.store.list_audit()
        self.assertEqual(["Second staged rollout change", "First staged rollout change"], [event["reason"] for event in audit])
        latest = audit[0]
        uuid.UUID(latest["id"])
        self.assertEqual(self.key, latest["key"])
        self.assertEqual("staging", latest["environment"])
        self.assertEqual("Operator two", latest["actor"])
        self.assertEqual("updated", latest["action"])
        datetime.fromisoformat(latest["timestamp"])
        self.assertEqual(first, latest["before"])
        self.assertEqual(second, latest["after"])
        self.assertEqual(original, audit[1]["before"])
        returned = self.store.get_flag(self.key)
        listed = self.store.list_flags()
        returned["enabled"] = False
        listed[0]["version"] = 999
        audit[0]["after"]["version"] = 999
        audit[1]["before"]["enabled"] = "mutated"
        self.assertEqual(second, self.store.get_flag(self.key))
        fresh_audit = self.store.list_audit()
        self.assertEqual(3, fresh_audit[0]["after"]["version"])
        self.assertIs(type(fresh_audit[1]["before"]["enabled"]), bool)

    def test_rollback_restores_latest_before_snapshot_with_new_versions(self):
        initial = self.store.get_flag(self.key)
        first = self.store.update_flag(
            self.key,
            "staging",
            enabled=False,
            rollout_percent=25,
            reason="First state to retain later",
            expected_version=1,
        )
        second = self.store.update_flag(
            self.key,
            "staging",
            enabled=True,
            rollout_percent=75,
            reason="Second state to roll back",
            expected_version=2,
        )
        rolled_back = self.store.rollback_flag(
            self.key,
            "staging",
            reason="Restore the prior staged state",
            expected_version=3,
            actor="Rollback operator",
        )
        self.assertEqual(first["enabled"], rolled_back["enabled"])
        self.assertEqual(first["rollout_percent"], rolled_back["rollout_percent"])
        self.assertEqual(4, rolled_back["version"])
        self.assertEqual("Rollback operator", rolled_back["updated_by"])
        audit = self.store.list_audit()
        self.assertEqual("rolled_back", audit[0]["action"])
        self.assertEqual(second, audit[0]["before"])
        self.assertEqual(rolled_back, audit[0]["after"])
        rolled_forward = self.store.rollback_flag(
            self.key,
            "staging",
            reason="Reverse the preceding rollback",
            expected_version=4,
        )
        self.assertEqual(second["enabled"], rolled_forward["enabled"])
        self.assertEqual(second["rollout_percent"], rolled_forward["rollout_percent"])
        self.assertEqual(5, rolled_forward["version"])
        self.assertEqual(1, initial["version"])

    def test_rollback_without_history_fails_without_mutation(self):
        original = self.store.get_flag(self.key)
        with self.assertRaises(ValueError):
            self.store.rollback_flag(
                self.key,
                "staging",
                reason="There is no prior change",
                expected_version=1,
            )
        self.assertEqual(original, self.store.get_flag(self.key))
        self.assertEqual([], self.store.list_audit())

    def test_no_op_update_fails_without_audit(self):
        original = self.store.get_flag(self.key)
        with self.assertRaises(ValueError):
            self.store.update_flag(
                self.key,
                "staging",
                enabled=original["enabled"],
                rollout_percent=original["rollout_percent"],
                reason="No effective staged change",
                expected_version=original["version"],
            )
        self.assertEqual(original, self.store.get_flag(self.key))
        self.assertEqual([], self.store.list_audit())

    def test_instances_are_independent_and_restart_clean(self):
        other = FlagStore()
        other_original = other.get_flag(self.key)
        self.store.update_flag(
            self.key,
            "staging",
            enabled=False,
            rollout_percent=25,
            reason="Only alter the first instance",
            expected_version=1,
        )
        self.assertEqual(other_original, other.get_flag(self.key))
        self.assertEqual([], other.list_audit())
        restarted = FlagStore()
        self.assertEqual(1, restarted.get_flag(self.key)["version"])
        self.assertEqual([], restarted.list_audit())


if __name__ == "__main__":
    unittest.main()
