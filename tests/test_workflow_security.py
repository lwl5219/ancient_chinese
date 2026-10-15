import re
import unittest
from pathlib import Path


class WorkflowSecurityTests(unittest.TestCase):
    def test_external_actions_are_immutable_and_checkout_does_not_persist_credentials(self):
        workflows = Path(__file__).resolve().parents[1] / '.github/workflows'
        for path in workflows.glob('*.yml'):
            text = path.read_text()
            for line in text.splitlines():
                match = re.search(r'\buses:\s+(\S+)', line)
                if match and not match[1].startswith('./'):
                    self.assertRegex(match[1], r'^actions/[a-z-]+@[0-9a-f]{40}$', str(path))
            checkouts = re.findall(r'uses: actions/checkout@[^\n]+\n((?:\s{8,}[^\n]*\n)*)', text)
            self.assertEqual(len(checkouts), 1, str(path))
            for config in checkouts:
                self.assertIn('persist-credentials: false', config, str(path))
