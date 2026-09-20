import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.parse import urlencode

import app


class AppHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.dist_dir = Path(self.temp_dir.name) / "dist"
        assets_dir = self.dist_dir / "assets"
        assets_dir.mkdir(parents=True)
        (self.dist_dir / "index.html").write_text(
            '<!doctype html><div id="root"></div><script src="/assets/index-demo123.js"></script>',
            encoding="utf-8",
        )
        (assets_dir / "index-demo123.js").write_text("globalThis.demo = true;", encoding="utf-8")
        (assets_dir / "index-demo123.css").write_text("body { color: black; }", encoding="utf-8")
        self.server = app.create_server(dist_dir=self.dist_dir)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.host, self.port = self.server.server_address

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp_dir.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection(self.host, self.port, timeout=3)
        request_headers = dict(headers or {})
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode("utf-8")
        connection.request(method, path, body=body, headers=request_headers)
        response = connection.getresponse()
        raw = response.read()
        response_headers = dict(response.getheaders())
        connection.close()
        if response_headers.get("Content-Type", "").startswith("application/json"):
            content = json.loads(raw)
        else:
            content = raw
        return response.status, response_headers, content

    def post(self, path, payload, headers=None):
        request_headers = {
            "Content-Type": "application/json",
            "X-Demo-Request": "1",
        }
        if headers:
            request_headers.update(headers)
        return self.request("POST", path, payload, request_headers)

    def update_payload(self, environment="staging", version=1, confirmation=""):
        return {
            "environment": environment,
            "enabled": False,
            "rollout_percent": 25,
            "reason": "Exercise a deliberate demo change",
            "expected_version": version,
            "confirmation": confirmation,
        }

    def assert_error(self, result, status, code):
        self.assertEqual(status, result[0])
        self.assertEqual(code, result[2]["error"]["code"])
        self.assertEqual({"code", "message"}, set(result[2]["error"]))

    def test_built_index_and_generated_assets_are_served_with_security_headers(self):
        for path, content_type in (
            ("/", "text/html"),
            ("/index.html", "text/html"),
            ("/assets/index-demo123.js", "text/javascript"),
            ("/assets/index-demo123.css", "text/css"),
        ):
            with self.subTest(path=path):
                status, headers, content = self.request("GET", path)
                self.assertEqual(200, status)
                self.assertTrue(headers["Content-Type"].startswith(content_type))
                self.assertTrue(content)
                self.assertEqual("nosniff", headers["X-Content-Type-Options"])
                self.assertEqual("DENY", headers["X-Frame-Options"])
                self.assertIn("default-src 'self'", headers["Content-Security-Policy"])

    def test_static_routes_reject_legacy_workspace_and_traversal_paths(self):
        paths = (
            "/app.js",
            "/styles.css",
            "/app.py",
            "/refunds.py",
            "/package.json",
            "/src/main.tsx",
            "/assets/index-demo123.js.map",
            "/assets/arbitrary.js",
            "/assets/../index.html",
            "/assets/%2e%2e/index.html",
            "/assets/%2e%2e%2fapp.py",
            "/assets/nested/index-demo123.js",
        )
        for path in paths:
            with self.subTest(path=path):
                self.assert_error(self.request("GET", path), 404, "not_found")

    def test_static_assets_reject_symlink_escape(self):
        outside = Path(self.temp_dir.name) / "outside.js"
        outside.write_text("globalThis.secret = true;", encoding="utf-8")
        link = self.dist_dir / "assets" / "escaped-demo123.js"
        try:
            link.symlink_to(outside)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks are unavailable")
        self.assert_error(self.request("GET", "/assets/escaped-demo123.js"), 404, "not_found")

    def test_missing_frontend_build_has_controlled_helpful_response(self):
        self.server.dist_dir = Path(self.temp_dir.name) / "missing-dist"
        result = self.request("GET", "/")
        self.assert_error(result, 503, "build_missing")
        self.assertIn("npm run build", result[2]["error"]["message"])
        self.assert_error(self.request("GET", "/assets/index-demo123.js"), 404, "not_found")

    def test_health_and_unknown_query_validation(self):
        status, headers, payload = self.request("GET", "/api/health")
        self.assertEqual(200, status)
        self.assertEqual({"status": "ok", "demo": True}, payload)
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assert_error(
            self.request("GET", "/api/health?unexpected=1"),
            400,
            "validation_error",
        )

    def test_refund_filters_summary_and_detail(self):
        query = urlencode({"query": "order returned", "status": "completed"})
        status, _, payload = self.request("GET", "/api/refunds?" + query)
        self.assertEqual(200, status)
        self.assertEqual(["ref_0005", "ref_0010", "ref_0015"], [item["id"] for item in payload["refunds"]])
        self.assertEqual(20, payload["summary"]["total_count"])
        self.assertEqual(122721, payload["summary"]["total_amount_cents"])
        status, _, detail = self.request("GET", "/api/refunds/ref_0008")
        self.assertEqual(200, status)
        self.assertEqual("pay_1008", detail["payment_id"])
        self.assertIn("unconfirmed", detail["timeline"][-1]["detail"])
        self.assert_error(self.request("GET", "/api/refunds/missing"), 404, "not_found")

    def test_invalid_refund_status_and_repeated_filter(self):
        self.assert_error(
            self.request("GET", "/api/refunds?status=refunded"),
            400,
            "validation_error",
        )
        self.assert_error(
            self.request("GET", "/api/refunds?status=pending&status=failed"),
            400,
            "validation_error",
        )

    def test_refunds_are_read_only(self):
        result = self.post("/api/refunds/ref_0001", self.update_payload())
        self.assert_error(result, 404, "not_found")
        result = self.request("DELETE", "/api/refunds/ref_0001")
        self.assert_error(result, 405, "method_not_allowed")

    def test_malformed_nonobject_and_payload_key_validation(self):
        headers = {"Content-Type": "application/json", "X-Demo-Request": "1"}
        self.assert_error(
            self.request("POST", "/api/flags/new_checkout_flow", b"{not json", headers),
            400,
            "validation_error",
        )
        self.assert_error(
            self.request("POST", "/api/flags/new_checkout_flow", [1, 2], headers),
            400,
            "validation_error",
        )
        payload = self.update_payload()
        payload["actor"] = "Invented operator"
        self.assert_error(
            self.post("/api/flags/new_checkout_flow", payload),
            400,
            "validation_error",
        )

    def test_oversized_body_is_rejected(self):
        body = json.dumps({"padding": "x" * (app.MAX_BODY_BYTES + 1)}).encode("utf-8")
        result = self.request(
            "POST",
            "/api/flags/new_checkout_flow",
            body,
            {"Content-Type": "application/json", "X-Demo-Request": "1"},
        )
        self.assert_error(result, 400, "validation_error")
        self.assertIn("16KB", result[2]["error"]["message"])

    def test_wrong_content_type_and_missing_custom_header(self):
        body = json.dumps(self.update_payload()).encode("utf-8")
        self.assert_error(
            self.request(
                "POST",
                "/api/flags/new_checkout_flow",
                body,
                {"Content-Type": "text/plain", "X-Demo-Request": "1"},
            ),
            400,
            "validation_error",
        )
        self.assert_error(
            self.request(
                "POST",
                "/api/flags/new_checkout_flow",
                body,
                {"Content-Type": "application/json"},
            ),
            400,
            "validation_error",
        )

    def test_cross_origin_mutation_is_rejected(self):
        result = self.post(
            "/api/flags/new_checkout_flow",
            self.update_payload(),
            {"Origin": "https://malicious.example"},
        )
        self.assert_error(result, 400, "validation_error")
        allowed = f"http://127.0.0.1:{self.port}"
        status, _, payload = self.post(
            "/api/flags/new_checkout_flow",
            self.update_payload(),
            {"Origin": allowed},
        )
        self.assertEqual(200, status)
        self.assertEqual(2, payload["version"])

    def test_flag_update_audit_and_fixed_actor(self):
        status, _, listing = self.request("GET", "/api/flags?environment=staging")
        self.assertEqual(200, status)
        self.assertEqual("staging", listing["environment"])
        self.assertEqual(6, len(listing["flags"]))
        status, _, updated = self.post(
            "/api/flags/new_checkout_flow", self.update_payload()
        )
        self.assertEqual(200, status)
        self.assertFalse(updated["enabled"])
        self.assertEqual(25, updated["rollout_percent"])
        self.assertEqual("Demo operator", updated["updated_by"])
        status, _, audit = self.request("GET", "/api/audit?environment=staging")
        self.assertEqual(200, status)
        self.assertEqual("Demo operator", audit["events"][0]["actor"])
        self.assertEqual("updated", audit["events"][0]["action"])

    def test_stale_update_returns_conflict(self):
        self.post("/api/flags/new_checkout_flow", self.update_payload())
        payload = self.update_payload()
        payload["rollout_percent"] = 40
        result = self.post("/api/flags/new_checkout_flow", payload)
        self.assert_error(result, 409, "conflict")

    def test_production_requires_exact_confirmation(self):
        payload = self.update_payload(environment="production")
        payload["enabled"] = True
        payload["rollout_percent"] = 10
        self.assert_error(
            self.post("/api/flags/new_checkout_flow", payload),
            400,
            "validation_error",
        )
        payload["confirmation"] = "new_checkout_flow"
        status, _, updated = self.post("/api/flags/new_checkout_flow", payload)
        self.assertEqual(200, status)
        self.assertTrue(updated["enabled"])

    def test_rollback_restores_before_state(self):
        _, _, updated = self.post(
            "/api/flags/new_checkout_flow", self.update_payload()
        )
        rollback = {
            "environment": "staging",
            "reason": "Restore the earlier staged configuration",
            "expected_version": updated["version"],
            "confirmation": "",
        }
        status, _, restored = self.post(
            "/api/flags/new_checkout_flow/rollback", rollback
        )
        self.assertEqual(200, status)
        self.assertTrue(restored["enabled"])
        self.assertEqual(50, restored["rollout_percent"])
        self.assertEqual(3, restored["version"])

    def test_environment_state_and_audit_are_isolated(self):
        before = self.request("GET", "/api/flags?environment=development")[2]
        self.post("/api/flags/new_checkout_flow", self.update_payload())
        after = self.request("GET", "/api/flags?environment=development")[2]
        self.assertEqual(before, after)
        development_audit = self.request("GET", "/api/audit?environment=development")[2]
        staging_audit = self.request("GET", "/api/audit?environment=staging")[2]
        self.assertEqual([], development_audit["events"])
        self.assertEqual(1, len(staging_audit["events"]))

    def test_unknown_resources_environments_and_methods(self):
        self.assert_error(self.request("GET", "/api/unknown"), 404, "not_found")
        self.assert_error(
            self.request("GET", "/api/flags?environment=qa"),
            400,
            "validation_error",
        )
        self.assert_error(
            self.post("/api/flags/missing", self.update_payload()),
            404,
            "not_found",
        )
        result = self.request("PATCH", "/api/flags/new_checkout_flow")
        self.assert_error(result, 405, "method_not_allowed")
        self.assertEqual("GET, POST", result[1]["Allow"])

    def test_new_server_has_fresh_flag_store(self):
        self.post("/api/flags/new_checkout_flow", self.update_payload())
        other = app.create_server()
        try:
            self.assertEqual(1, other.flag_store.get_flag("new_checkout_flow")["version"])
            self.assertEqual([], other.flag_store.list_audit())
        finally:
            other.server_close()


if __name__ == "__main__":
    unittest.main()
