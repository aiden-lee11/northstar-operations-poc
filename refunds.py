from copy import deepcopy as _deepcopy


__all__ = ["list_refunds", "get_refund", "refund_summary"]

_VALID_STATUSES = frozenset({"pending", "processing", "completed", "failed"})

_REFUND_DATA = (
    ("ref_0001", "pay_1001", "Amelia Stone <amelia.stone@example.test>", 1299, "duplicate charge", "completed", "2025-01-03T09:15:00Z", "2025-01-04T11:20:00Z", "Maya Chen", "prv_us_0001", "Refund settled to the original payment method."),
    ("ref_0002", "pay_1002", "Noah Williams <noah.williams@example.test>", 4500, "service canceled", "pending", "2025-01-05T14:30:00Z", "2025-01-06T08:10:00Z", "Eli Turner", "prv_us_0002", "Awaiting the customer's bank to acknowledge the refund request."),
    ("ref_0003", "pay_1003", "Olivia Hart <olivia.hart@example.test>", 8750, "product not received", "processing", "2025-01-07T10:05:00Z", "2025-01-07T16:45:00Z", "Maya Chen", "prv_us_0003", "Provider accepted the request and is routing funds to the issuer."),
    ("ref_0004", "pay_1004", "Liam Brooks <liam.brooks@example.test>", 2199, "incorrect item", "failed", "2025-01-09T12:40:00Z", "2025-01-10T09:00:00Z", "Priya Shah", "prv_us_0004", "The provider rejected the refund because the destination account is closed."),
    ("ref_0005", "pay_1005", "Emma Rivers <emma.rivers@example.test>", 15900, "order returned", "completed", "2025-01-11T08:20:00Z", "2025-01-13T13:35:00Z", "Eli Turner", "prv_us_0005", "Refund settled to the original payment method."),
    ("ref_0006", "pay_1006", "Elijah Grant <elijah.grant@example.test>", 3200, "billing error", "pending", "2025-01-14T15:10:00Z", "2025-01-15T10:25:00Z", "Jon Bell", "prv_us_0006", "Manual review is pending because the billed amount differs from the receipt."),
    ("ref_0007", "pay_1007", "Ava Monroe <ava.monroe@example.test>", 999, "duplicate charge", "completed", "2025-01-17T11:55:00Z", "2025-01-18T14:15:00Z", "Priya Shah", "prv_us_0007", "Refund settled to the original payment method."),
    ("ref_0008", "pay_1008", "Lucas Bennett <lucas.bennett@example.test>", 6400, "subscription canceled", "failed", "2025-01-20T09:45:00Z", "2025-01-21T17:05:00Z", "Maya Chen", "prv_us_0008", "The provider timed out; the outcome is unconfirmed and must be reconciled before any retry."),
    ("ref_0009", "pay_1009", "Sophia Lane <sophia.lane@example.test>", 2850, "late delivery", "processing", "2025-01-23T13:25:00Z", "2025-01-24T09:50:00Z", "Jon Bell", "prv_us_0009", "Provider accepted the request and is waiting for issuer confirmation."),
    ("ref_0010", "pay_1010", "Mason Cole <mason.cole@example.test>", 11250, "order returned", "completed", "2025-01-26T16:00:00Z", "2025-01-28T12:30:00Z", "Eli Turner", "prv_us_0010", "Refund settled to the original payment method."),
    ("ref_0011", "pay_1011", "Isabella Reed <isabella.reed@example.test>", 775, "price adjustment", "completed", "2025-02-01T08:35:00Z", "2025-02-01T18:10:00Z", "Priya Shah", "prv_us_0011", "Refund settled to the original payment method."),
    ("ref_0012", "pay_1012", "Ethan Parker <ethan.parker@example.test>", 5300, "damaged product", "pending", "2025-02-03T10:50:00Z", "2025-02-04T11:40:00Z", "Maya Chen", "prv_us_0012", "Awaiting supporting return documentation before provider submission."),
    ("ref_0013", "pay_1013", "Mia Foster <mia.foster@example.test>", 18499, "service unavailable", "processing", "2025-02-06T14:05:00Z", "2025-02-07T08:55:00Z", "Jon Bell", "prv_us_0013", "Provider accepted the request and is routing funds to the issuer."),
    ("ref_0014", "pay_1014", "James Walsh <james.walsh@example.test>", 2500, "duplicate charge", "failed", "2025-02-09T09:30:00Z", "2025-02-10T15:20:00Z", "Eli Turner", "prv_us_0014", "The provider could not match the original payment reference."),
    ("ref_0015", "pay_1015", "Charlotte West <charlotte.west@example.test>", 7250, "order returned", "completed", "2025-02-12T12:15:00Z", "2025-02-14T10:45:00Z", "Priya Shah", "prv_us_0015", "Refund settled to the original payment method."),
    ("ref_0016", "pay_1016", "Benjamin Ross <benjamin.ross@example.test>", 4100, "accidental purchase", "pending", "2025-02-16T17:20:00Z", "2025-02-17T09:05:00Z", "Maya Chen", "prv_us_0016", "The request is in the mandatory review window before processing."),
    ("ref_0017", "pay_1017", "Harper Young <harper.young@example.test>", 3600, "incorrect item", "processing", "2025-02-19T11:10:00Z", "2025-02-20T13:00:00Z", "Jon Bell", "prv_us_0017", "Provider accepted the request and is waiting for issuer confirmation."),
    ("ref_0018", "pay_1018", "Henry Scott <henry.scott@example.test>", 9200, "event canceled", "completed", "2025-02-22T07:55:00Z", "2025-02-24T16:25:00Z", "Eli Turner", "prv_us_0018", "Refund settled to the original payment method."),
    ("ref_0019", "pay_1019", "Evelyn King <evelyn.king@example.test>", 1350, "billing error", "failed", "2025-02-25T13:40:00Z", "2025-02-26T10:30:00Z", "Priya Shah", "prv_us_0019", "The issuer declined the refund because the payment method is no longer valid."),
    ("ref_0020", "pay_1020", "Alexander Gray <alexander.gray@example.test>", 12800, "service canceled", "completed", "2025-02-27T15:25:00Z", "2025-03-01T09:15:00Z", "Maya Chen", "prv_us_0020", "Refund settled to the original payment method."),
)


def _make_refund(record: tuple) -> dict:
    refund_id, payment_id, customer, amount_cents, reason, status, created_at, updated_at, owner, provider_reference, detail = record
    timeline = [
        {
            "timestamp": created_at,
            "event": "refund_requested",
            "detail": f"Refund requested for {reason}.",
        },
        {
            "timestamp": updated_at,
            "event": f"refund_{status}",
            "detail": detail,
        },
    ]
    return {
        "id": refund_id,
        "payment_id": payment_id,
        "customer": customer,
        "amount_cents": amount_cents,
        "currency": "USD",
        "reason": reason,
        "status": status,
        "created_at": created_at,
        "updated_at": updated_at,
        "owner": owner,
        "provider_reference": provider_reference,
        "timeline": timeline,
    }


_REFUNDS = tuple(_make_refund(record) for record in _REFUND_DATA)


def list_refunds(query: str = "", status: str = "") -> list[dict]:
    normalized_status = status.strip().casefold()
    if normalized_status and normalized_status not in _VALID_STATUSES:
        raise ValueError(f"Unknown refund status: {status}")
    normalized_query = query.strip().casefold()
    matches = []
    for refund in _REFUNDS:
        if normalized_status and refund["status"] != normalized_status:
            continue
        searchable = (
            refund["id"],
            refund["payment_id"],
            refund["customer"],
            refund["reason"],
        )
        if normalized_query and not any(normalized_query in value.casefold() for value in searchable):
            continue
        matches.append(refund)
    return _deepcopy(matches)


def get_refund(refund_id: str) -> dict | None:
    for refund in _REFUNDS:
        if refund["id"] == refund_id:
            return _deepcopy(refund)
    return None


def refund_summary() -> dict:
    return {
        "total_count": len(_REFUNDS),
        "total_amount_cents": sum(refund["amount_cents"] for refund in _REFUNDS),
        "pending_count": sum(refund["status"] == "pending" for refund in _REFUNDS),
        "failed_count": sum(refund["status"] == "failed" for refund in _REFUNDS),
        "completed_count": sum(refund["status"] == "completed" for refund in _REFUNDS),
        "currency": "USD",
    }
