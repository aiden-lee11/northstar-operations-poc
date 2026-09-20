import unittest

from backend import refunds


class RefundsTests(unittest.TestCase):
    def test_lists_all_refunds_for_blank_filters(self):
        self.assertEqual(len(refunds.list_refunds()), 20)
        self.assertEqual(len(refunds.list_refunds(status="   ")), 20)

    def test_filters_by_status(self):
        pending = refunds.list_refunds(status="pending")
        self.assertEqual(len(pending), 4)
        self.assertTrue(all(item["status"] == "pending" for item in pending))
        self.assertEqual(len(refunds.list_refunds(status="COMPLETED")), 8)

    def test_unknown_status_raises_value_error(self):
        with self.assertRaises(ValueError):
            refunds.list_refunds(status="refunded")

    def test_searches_all_supported_fields_case_insensitively(self):
        cases = (
            ("REF_0003", "ref_0003"),
            ("PAY_1011", "ref_0011"),
            ("EVELYN.KING", "ref_0019"),
            ("DUPLICATE CHARGE", "ref_0001"),
        )
        for query, expected_id in cases:
            with self.subTest(query=query):
                ids = [item["id"] for item in refunds.list_refunds(query=query)]
                self.assertIn(expected_id, ids)

    def test_combines_search_and_status_filter(self):
        completed_returns = refunds.list_refunds(query="order returned", status="completed")
        self.assertEqual(
            [item["id"] for item in completed_returns],
            ["ref_0005", "ref_0010", "ref_0015"],
        )
        self.assertEqual(refunds.list_refunds(query="order returned", status="failed"), [])

    def test_gets_refund_and_returns_none_for_missing_record(self):
        item = refunds.get_refund("ref_0008")
        self.assertIsNotNone(item)
        self.assertEqual(item["payment_id"], "pay_1008")
        self.assertIsNone(refunds.get_refund("ref_missing"))

    def test_list_results_are_deep_defensive_copies(self):
        first_result = refunds.list_refunds(query="ref_0002")
        first_result[0]["customer"] = "changed"
        first_result[0]["timeline"][0]["detail"] = "changed"
        second_result = refunds.list_refunds(query="ref_0002")
        self.assertNotEqual(second_result[0]["customer"], "changed")
        self.assertNotEqual(second_result[0]["timeline"][0]["detail"], "changed")

    def test_get_result_is_a_deep_defensive_copy(self):
        first_result = refunds.get_refund("ref_0004")
        first_result["timeline"].append({"timestamp": "changed", "event": "changed", "detail": "changed"})
        first_result["timeline"][1]["detail"] = "changed"
        second_result = refunds.get_refund("ref_0004")
        self.assertEqual(len(second_result["timeline"]), 2)
        self.assertNotEqual(second_result["timeline"][1]["detail"], "changed")

    def test_money_is_integer_usd(self):
        all_refunds = refunds.list_refunds()
        self.assertTrue(all(type(item["amount_cents"]) is int for item in all_refunds))
        self.assertTrue(all(item["currency"] == "USD" for item in all_refunds))

    def test_records_have_required_shape_and_timeline(self):
        required_keys = {
            "id",
            "payment_id",
            "customer",
            "amount_cents",
            "currency",
            "reason",
            "status",
            "created_at",
            "updated_at",
            "owner",
            "provider_reference",
            "timeline",
        }
        for item in refunds.list_refunds():
            self.assertEqual(set(item), required_keys)
            self.assertGreaterEqual(len(item["timeline"]), 2)
            for event in item["timeline"]:
                self.assertEqual(set(event), {"timestamp", "event", "detail"})

    def test_pending_and_failed_timelines_explain_their_state(self):
        for status in ("pending", "failed"):
            for item in refunds.list_refunds(status=status):
                latest = item["timeline"][-1]
                self.assertEqual(latest["event"], f"refund_{status}")
                self.assertTrue(latest["detail"].strip())

    def test_summary_is_correct(self):
        self.assertEqual(
            refunds.refund_summary(),
            {
                "total_count": 20,
                "total_amount_cents": 122721,
                "pending_count": 4,
                "failed_count": 4,
                "completed_count": 8,
                "currency": "USD",
            },
        )


if __name__ == "__main__":
    unittest.main()
