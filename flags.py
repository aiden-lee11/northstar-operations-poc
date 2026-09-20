import copy
import threading
import uuid
from datetime import datetime, timezone


class ConflictError(ValueError):
    pass


class FlagStore:
    _ENVIRONMENTS = ("development", "staging", "production")
    _SEEDS = (
        (
            "new_checkout_flow",
            "New checkout flow",
            "Enables the streamlined multi-step checkout experience.",
            "Commerce Platform",
            "high",
        ),
        (
            "smart_search_ranking",
            "Smart search ranking",
            "Uses the latest relevance model for product search results.",
            "Search Experience",
            "medium",
        ),
        (
            "customer_saved_views",
            "Customer saved views",
            "Allows customers to save and reuse filtered catalog views.",
            "Customer Experience",
            "low",
        ),
        (
            "realtime_inventory",
            "Realtime inventory",
            "Displays frequently refreshed inventory availability.",
            "Inventory Systems",
            "high",
        ),
        (
            "account_security_alerts",
            "Account security alerts",
            "Sends proactive alerts for unusual account activity.",
            "Trust and Safety",
            "medium",
        ),
        (
            "self_service_exports",
            "Self-service exports",
            "Lets workspace administrators request data exports.",
            "Data Platform",
            "low",
        ),
    )

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._flags = {}
        self._audit = []
        timestamp = self._utc_now()
        environment_defaults = {
            "development": (True, 100),
            "staging": (True, 50),
            "production": (False, 0),
        }
        for environment in self._ENVIRONMENTS:
            enabled, rollout_percent = environment_defaults[environment]
            self._flags[environment] = {}
            for key, name, description, owner, risk in self._SEEDS:
                self._flags[environment][key] = {
                    "key": key,
                    "name": name,
                    "description": description,
                    "owner": owner,
                    "risk": risk,
                    "environment": environment,
                    "enabled": enabled,
                    "rollout_percent": rollout_percent,
                    "version": 1,
                    "updated_at": timestamp,
                    "updated_by": "System seed",
                }

    def list_flags(self, environment: str = "staging") -> list[dict]:
        with self._lock:
            self._validate_environment(environment)
            return copy.deepcopy(list(self._flags[environment].values()))

    def get_flag(self, key: str, environment: str = "staging") -> dict:
        with self._lock:
            self._validate_environment(environment)
            try:
                flag = self._flags[environment][key]
            except (KeyError, TypeError):
                raise KeyError(key)
            return copy.deepcopy(flag)

    def update_flag(
        self,
        key: str,
        environment: str,
        *,
        enabled: bool,
        rollout_percent: int,
        reason: str,
        expected_version: int,
        actor: str = "Demo operator",
        confirmation: str = "",
    ) -> dict:
        with self._lock:
            self._validate_environment(environment)
            self._validate_enabled(enabled)
            self._validate_rollout_percent(rollout_percent)
            self._validate_expected_version(expected_version)
            normalized_reason = self._validate_reason(reason)
            normalized_actor = self._validate_actor(actor)
            self._validate_confirmation(key, environment, confirmation)
            current = self._find_flag(key, environment)
            self._validate_version(current, expected_version)
            if (
                current["enabled"] == enabled
                and current["rollout_percent"] == rollout_percent
            ):
                raise ValueError("update must change enabled or rollout_percent")
            return self._apply_change(
                current,
                enabled,
                rollout_percent,
                normalized_reason,
                normalized_actor,
                "updated",
            )

    def list_audit(self, environment: str = "staging") -> list[dict]:
        with self._lock:
            self._validate_environment(environment)
            records = [
                record for record in reversed(self._audit)
                if record["environment"] == environment
            ]
            return copy.deepcopy(records)

    def rollback_flag(
        self,
        key: str,
        environment: str,
        *,
        reason: str,
        expected_version: int,
        actor: str = "Demo operator",
        confirmation: str = "",
    ) -> dict:
        with self._lock:
            self._validate_environment(environment)
            self._validate_expected_version(expected_version)
            normalized_reason = self._validate_reason(reason)
            normalized_actor = self._validate_actor(actor)
            self._validate_confirmation(key, environment, confirmation)
            current = self._find_flag(key, environment)
            self._validate_version(current, expected_version)
            source = next(
                (
                    record
                    for record in reversed(self._audit)
                    if record["key"] == key
                    and record["environment"] == environment
                ),
                None,
            )
            if source is None:
                raise ValueError("no audit history available for rollback")
            before = source["before"]
            return self._apply_change(
                current,
                before["enabled"],
                before["rollout_percent"],
                normalized_reason,
                normalized_actor,
                "rolled_back",
            )

    @staticmethod
    def _utc_now():
        return datetime.now(timezone.utc).isoformat()

    def _validate_environment(self, environment):
        if environment not in self._ENVIRONMENTS:
            raise ValueError("environment must be development, staging, or production")

    @staticmethod
    def _validate_enabled(enabled):
        if type(enabled) is not bool:
            raise ValueError("enabled must be a bool")

    @staticmethod
    def _validate_rollout_percent(rollout_percent):
        if type(rollout_percent) is not int or not 0 <= rollout_percent <= 100:
            raise ValueError("rollout_percent must be an int from 0 to 100")

    @staticmethod
    def _validate_expected_version(expected_version):
        if type(expected_version) is not int:
            raise ValueError("expected_version must be an int")

    @staticmethod
    def _validate_reason(reason):
        if not isinstance(reason, str):
            raise ValueError("reason must be a string")
        normalized = reason.strip()
        if not 8 <= len(normalized) <= 500:
            raise ValueError("reason must contain 8 to 500 characters after trimming")
        return normalized

    @staticmethod
    def _validate_actor(actor):
        if not isinstance(actor, str):
            raise ValueError("actor must be a string")
        normalized = actor.strip()
        if not normalized or len(normalized) > 100:
            raise ValueError("actor must contain 1 to 100 characters")
        return normalized

    @staticmethod
    def _validate_confirmation(key, environment, confirmation):
        if environment == "production" and confirmation != key:
            raise ValueError("production changes require confirmation matching the key")

    def _find_flag(self, key, environment):
        try:
            return self._flags[environment][key]
        except (KeyError, TypeError):
            raise KeyError(key)

    @staticmethod
    def _validate_version(current, expected_version):
        if current["version"] != expected_version:
            raise ConflictError(
                "expected version {} but found {}".format(
                    expected_version, current["version"]
                )
            )

    def _apply_change(
        self,
        current,
        enabled,
        rollout_percent,
        reason,
        actor,
        action,
    ):
        before = copy.deepcopy(current)
        after = copy.deepcopy(current)
        after["enabled"] = enabled
        after["rollout_percent"] = rollout_percent
        after["version"] = current["version"] + 1
        after["updated_at"] = self._utc_now()
        after["updated_by"] = actor
        record = {
            "id": str(uuid.uuid4()),
            "key": current["key"],
            "environment": current["environment"],
            "actor": actor,
            "reason": reason,
            "timestamp": after["updated_at"],
            "action": action,
            "before": copy.deepcopy(before),
            "after": copy.deepcopy(after),
        }
        self._flags[current["environment"]][current["key"]] = after
        self._audit.append(record)
        return copy.deepcopy(after)
