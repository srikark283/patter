import io
import json
import unittest
from unittest.mock import patch
import run


class Stream(io.BytesIO):
    pass


class RunnerTests(unittest.TestCase):
    def stream(self, chunks):
        return Stream(b"\n".join(json.dumps(c).encode() for c in chunks))

    def test_meaning_sensitive_comparison(self):
        case = {"expected": ["Do not deploy."]}
        self.assertTrue(run.score(case, " Do not deploy.\r\n"))
        self.assertFalse(run.score(case, "Do deploy."))
        self.assertFalse(run.score({"expected": ["$15"]}, "$50"))
        self.assertFalse(run.score({"expected": ["a\n\nb"]}, "a b"))

    def test_nearest_rank_percentiles(self):
        self.assertEqual(run.percentile(list(range(1, 21)), .95), 19)
        self.assertEqual(run.percentile([2], .5), 2)
        self.assertIsNone(run.percentile([], .95))

    def test_stream_metrics_and_hidden_thinking(self):
        chunks = [{"message": {"content": "<think>reason"}},
                  {"message": {"content": "</think>Hello."}},
                  {"done": True, "done_reason": "stop", "load_duration": 123,
                   "eval_count": 2, "message": {"content": ""}}]
        with patch.object(run, "post", return_value=self.stream(chunks)):
            output, stats = run.infer({})
        self.assertEqual(output, "Hello.")
        self.assertEqual(stats["load_duration"], 123)
        self.assertIsNotNone(stats["first_text_ms"])

    def test_incomplete_truncated_empty_and_error_fail(self):
        for chunks in ([{"message": {"content": "partial"}}],
                       [{"done": True, "done_reason": "length", "message": {"content": "partial"}}],
                       [{"done": True, "message": {"content": "[EMPTY]"}}],
                       [{"error": "out of memory"}]):
            with self.subTest(chunks=chunks), patch.object(run, "post", return_value=self.stream(chunks)):
                with self.assertRaises(RuntimeError):
                    run.infer({})

    def test_fixture_integrity(self):
        cases = json.loads(run.Path(__file__).with_name("cases.json").read_text())
        self.assertEqual(len(cases), len({c["id"] for c in cases}))
        for case in cases:
            self.assertTrue(case["input"])
            self.assertTrue(case["expected"])
            self.assertTrue(all(isinstance(x, str) and x for x in case["expected"]))


if __name__ == "__main__":
    unittest.main()
