import json
import unittest
from pathlib import Path

from verify_webhook import WebhookVerificationError, verify_webhook

VECTOR = json.loads((Path(__file__).parent.parent / "test-vector.json").read_text())


class VectorTests(unittest.TestCase):
    pass


def make_test(case):
    def test(self):
        def run():
            return verify_webhook(
                VECTOR["secret"],
                case["headers"],
                case["body"],
                now=VECTOR["now"],
                tolerance_seconds=VECTOR["tolerance_seconds"],
            )

        if case["expect"] == "valid":
            self.assertTrue(run())
        else:
            with self.assertRaises(WebhookVerificationError):
                run()

    return test


for _case in VECTOR["cases"]:
    setattr(VectorTests, f"test_{_case['name']}", make_test(_case))


class ExtraTests(unittest.TestCase):
    def test_header_names_are_case_insensitive(self):
        case = VECTOR["cases"][0]
        upper = {k.upper(): v for k, v in case["headers"].items()}
        self.assertTrue(verify_webhook(VECTOR["secret"], upper, case["body"], now=VECTOR["now"]))

    def test_accepts_bytes(self):
        case = VECTOR["cases"][0]
        self.assertTrue(
            verify_webhook(VECTOR["secret"], case["headers"], case["body"].encode(), now=VECTOR["now"])
        )


if __name__ == "__main__":
    unittest.main()
