import unittest
from unittest.mock import patch
from src.limits import DemoLimits, DemoLimit


class LimitTests(unittest.TestCase):
    def test_slots_are_reusable_after_disconnect(self):
        limits = DemoLimits()
        limits.acquire('a')
        limits.acquire('b')
        with self.assertRaises(DemoLimit):
            limits.acquire('c')
        limits.release()
        limits.acquire('c')
        self.assertEqual(limits.active, 2)

    def test_request_burst_is_bounded_across_sessions(self):
        limits = DemoLimits()
        with patch('src.limits.REQUESTS_PER_MINUTE', 2):
            limits.reserve_request()
            limits.reserve_request()
            with self.assertRaises(DemoLimit):
                limits.reserve_request()

    def test_character_budget_rejects_before_overspend(self):
        limits = DemoLimits()
        with patch('src.limits.DAILY_CHARACTERS', 10):
            limits.reserve_characters(8)
            with self.assertRaises(DemoLimit):
                limits.reserve_characters(3)
            limits.reserve_characters(2)
            self.assertEqual(limits.characters, 10)
