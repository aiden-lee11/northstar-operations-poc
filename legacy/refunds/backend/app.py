import argparse
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from . import refunds
from .flags import ConflictError, FlagStore, demo_accounts


BASE_DIR = Path(__file__).resolve().parents[1]
DIST_DIR = BASE_DIR / "dist"
MAX_BODY_BYTES = 16 * 1024
BUILT_ASSET = re.compile(r"^/assets/[A-Za-z0-9_]+-[A-Za-z0-9_-]{6,}\.(js|css)$")
ENVIRONMENTS = {"development", "staging", "production"}
REFUND_DETAIL = re.compile(r"^/api/refunds/([^/]+)$")
FLAG_UPDATE = re.compile(r"^/api/flags/([^/]+)$")
FLAG_ROLLBACK = re.compile(r"^/api/flags/([^/]+)/rollback$")
FLAG_EVALUATIONS = re.compile(r"^/api/flags/([^/]+)/evaluations$")


class DemoHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, server_address, handler_class, dist_dir):
        super().__init__(server_address, handler_class)
        self.flag_store = FlagStore()
        self.dist_dir = Path(dist_dir)


class DemoRequestHandler(BaseHTTPRequestHandler):
    server_version = "NorthstarDemo/1.0"
    sys_version = ""

    def log_message(self, format, *args):
        return

    def send_error(self, code, message=None, explain=None):
        if code == 501:
            self._error(
                405,
                "method_not_allowed",
                "Method not allowed",
                {"Allow": "GET, POST"},
            )
            return
        status = code if 400 <= code < 500 else 400
        self._error(status, "bad_request", message or "Bad request")

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path in ("/", "/index.html"):
            self._serve_index()
            return
        if parsed.path.startswith("/assets/"):
            self._serve_asset(parsed.path)
            return
        if parsed.path == "/api/health":
            if not self._validate_query(parsed.query, set()):
                return
            self._send_json(200, {"status": "ok", "demo": True})
            return
        if parsed.path == "/api/refunds":
            params = self._query_values(parsed.query, {"query", "status"})
            if params is None:
                return
            try:
                items = refunds.list_refunds(
                    query=params.get("query", ""), status=params.get("status", "")
                )
            except ValueError as error:
                self._error(400, "validation_error", str(error))
                return
            self._send_json(
                200, {"refunds": items, "summary": refunds.refund_summary()}
            )
            return
        detail_match = REFUND_DETAIL.fullmatch(parsed.path)
        if detail_match:
            if not self._validate_query(parsed.query, set()):
                return
            refund_id = unquote(detail_match.group(1))
            item = refunds.get_refund(refund_id)
            if item is None:
                self._error(404, "not_found", "Refund not found")
                return
            self._send_json(200, item)
            return
        if parsed.path == "/api/flags":
            params = self._query_values(parsed.query, {"environment"})
            if params is None:
                return
            environment = params.get("environment", "staging")
            try:
                items = self.server.flag_store.list_flags(environment)
            except ValueError as error:
                self._error(400, "validation_error", str(error))
                return
            self._send_json(200, {"flags": items, "environment": environment})
            return
        evaluation_match = FLAG_EVALUATIONS.fullmatch(parsed.path)
        if evaluation_match:
            params = self._query_values(parsed.query, {"environment", "account"})
            if params is None:
                return
            environment = params.get("environment", "staging")
            account = params.get("account")
            key = unquote(evaluation_match.group(1))
            try:
                snapshot = self.server.flag_store.evaluate_accounts(
                    key,
                    environment,
                    None if account is None else [account],
                )
            except KeyError:
                self._error(404, "not_found", "Flag not found")
                return
            except ValueError as error:
                self._error(400, "validation_error", str(error))
                return
            self._send_json(
                200,
                {
                    "key": key,
                    "environment": environment,
                    "flag": snapshot["flag"],
                    "accounts": demo_accounts(),
                    "evaluations": snapshot["evaluations"],
                },
            )
            return
        if parsed.path == "/api/audit":
            params = self._query_values(parsed.query, {"environment"})
            if params is None:
                return
            environment = params.get("environment", "staging")
            try:
                events = self.server.flag_store.list_audit(environment)
            except ValueError as error:
                self._error(400, "validation_error", str(error))
                return
            self._send_json(200, {"events": events, "environment": environment})
            return
        self._error(404, "not_found", "Resource not found")

    def do_POST(self):
        parsed = urlsplit(self.path)
        rollback_match = FLAG_ROLLBACK.fullmatch(parsed.path)
        update_match = FLAG_UPDATE.fullmatch(parsed.path)
        if not rollback_match and not update_match:
            self._error(404, "not_found", "Resource not found")
            return
        if parsed.query:
            self._error(400, "validation_error", "Query parameters are not allowed")
            return
        if not self._validate_mutation_request():
            return
        payload = self._read_json_object()
        if payload is None:
            return
        key = unquote((rollback_match or update_match).group(1))
        try:
            if rollback_match:
                required = {
                    "environment",
                    "reason",
                    "expected_version",
                    "confirmation",
                }
                if not self._validate_payload_keys(payload, required):
                    return
                result = self.server.flag_store.rollback_flag(
                    key,
                    payload["environment"],
                    reason=payload["reason"],
                    expected_version=payload["expected_version"],
                    actor="Demo operator",
                    confirmation=payload["confirmation"],
                )
            else:
                required = {
                    "environment",
                    "enabled",
                    "rollout_percent",
                    "reason",
                    "expected_version",
                    "confirmation",
                }
                if not self._validate_payload_keys(payload, required):
                    return
                result = self.server.flag_store.update_flag(
                    key,
                    payload["environment"],
                    enabled=payload["enabled"],
                    rollout_percent=payload["rollout_percent"],
                    reason=payload["reason"],
                    expected_version=payload["expected_version"],
                    actor="Demo operator",
                    confirmation=payload["confirmation"],
                )
        except ConflictError as error:
            self._error(409, "conflict", str(error))
            return
        except KeyError:
            self._error(404, "not_found", "Flag not found")
            return
        except ValueError as error:
            self._error(400, "validation_error", str(error))
            return
        self._send_json(200, result)

    def do_HEAD(self):
        self._unsupported_method()

    def do_PUT(self):
        self._unsupported_method()

    def do_PATCH(self):
        self._unsupported_method()

    def do_DELETE(self):
        self._unsupported_method()

    def do_OPTIONS(self):
        self._unsupported_method()

    def _unsupported_method(self):
        self._error(405, "method_not_allowed", "Method not allowed", {"Allow": "GET, POST"})

    def _serve_index(self):
        try:
            dist_root = self.server.dist_dir.resolve(strict=True)
            index_path = (dist_root / "index.html").resolve(strict=True)
            if index_path.parent != dist_root or not index_path.is_file():
                raise OSError
            content = index_path.read_bytes()
        except (OSError, RuntimeError):
            self._error(
                503,
                "build_missing",
                "Frontend build is unavailable. Run npm ci and npm run build, then retry.",
            )
            return
        self._send_static(content, "text/html; charset=utf-8")

    def _serve_asset(self, raw_path):
        path = unquote(raw_path)
        match = BUILT_ASSET.fullmatch(path)
        if not match:
            self._error(404, "not_found", "Resource not found")
            return
        try:
            dist_root = self.server.dist_dir.resolve(strict=True)
            assets_root = (dist_root / "assets").resolve(strict=True)
            if assets_root.parent != dist_root or not assets_root.is_dir():
                raise OSError
            asset_path = (assets_root / path.removeprefix("/assets/")).resolve(strict=True)
            asset_path.relative_to(assets_root)
            if asset_path.parent != assets_root or not asset_path.is_file():
                raise OSError
            content = asset_path.read_bytes()
        except (OSError, RuntimeError, ValueError):
            self._error(404, "not_found", "Resource not found")
            return
        content_type = "text/javascript; charset=utf-8" if match.group(1) == "js" else "text/css; charset=utf-8"
        self._send_static(content, content_type)

    def _send_static(self, content, content_type):
        headers = {
            "Content-Type": content_type,
            "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer",
            "Cache-Control": "no-cache",
        }
        self._send(200, content, headers)

    def _validate_mutation_request(self):
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            self._error(400, "validation_error", "Content-Type must be application/json")
            return False
        if self.headers.get("X-Demo-Request") != "1":
            self._error(400, "validation_error", "X-Demo-Request header must be 1")
            return False
        origin = self.headers.get("Origin")
        if origin:
            parsed = urlsplit(origin)
            expected_port = self.server.server_address[1]
            try:
                origin_port = parsed.port
            except ValueError:
                origin_port = None
            if (
                parsed.scheme != "http"
                or parsed.hostname != "127.0.0.1"
                or origin_port != expected_port
                or parsed.path not in ("", "/")
                or parsed.query
                or parsed.fragment
            ):
                self._error(400, "validation_error", "Origin is not allowed")
                return False
        return True

    def _read_json_object(self):
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            self._error(400, "validation_error", "Content-Length is required")
            return None
        try:
            length = int(raw_length)
        except ValueError:
            self._error(400, "validation_error", "Content-Length must be valid")
            return None
        if length < 0:
            self._error(400, "validation_error", "Content-Length must be valid")
            return None
        if length > MAX_BODY_BYTES:
            self.close_connection = True
            self._error(400, "validation_error", "Request body exceeds 16KB")
            return None
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._error(400, "validation_error", "Request body must be valid JSON")
            return None
        if not isinstance(payload, dict):
            self._error(400, "validation_error", "JSON body must be an object")
            return None
        return payload

    def _validate_payload_keys(self, payload, required):
        keys = set(payload)
        unexpected = sorted(keys - required)
        missing = sorted(required - keys)
        if unexpected:
            self._error(
                400,
                "validation_error",
                "Unexpected payload keys: " + ", ".join(unexpected),
            )
            return False
        if missing:
            self._error(
                400,
                "validation_error",
                "Missing payload keys: " + ", ".join(missing),
            )
            return False
        return True

    def _query_values(self, query, allowed):
        try:
            parsed = parse_qs(query, keep_blank_values=True, strict_parsing=True)
        except ValueError:
            self._error(400, "validation_error", "Query string is invalid")
            return None
        unexpected = sorted(set(parsed) - allowed)
        if unexpected:
            self._error(
                400,
                "validation_error",
                "Unexpected query parameters: " + ", ".join(unexpected),
            )
            return None
        repeated = sorted(key for key, values in parsed.items() if len(values) != 1)
        if repeated:
            self._error(
                400,
                "validation_error",
                "Query parameters may not be repeated: " + ", ".join(repeated),
            )
            return None
        return {key: values[0] for key, values in parsed.items()}

    def _validate_query(self, query, allowed):
        return self._query_values(query, allowed) is not None

    def _error(self, status, code, message, headers=None):
        self._send_json(status, {"error": {"code": code, "message": message}}, headers)

    def _send_json(self, status, payload, headers=None):
        content = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        merged = {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        }
        if headers:
            merged.update(headers)
        self._send(status, content, merged)

    def _send(self, status, content, headers):
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def create_server(port=0, dist_dir=DIST_DIR):
    if type(port) is not int or not 0 <= port <= 65535:
        raise ValueError("port must be an integer from 0 to 65535")
    return DemoHTTPServer(("127.0.0.1", port), DemoRequestHandler, dist_dir)


def parse_args():
    parser = argparse.ArgumentParser(prog="python3 -m backend.app")
    parser.add_argument("--port", type=int, default=8000)
    return parser.parse_args()


def main():
    args = parse_args()
    server = create_server(args.port)
    print(f"Northstar local demo at http://127.0.0.1:{server.server_address[1]}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Northstar local demo")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
