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

    def test_pages_retry_uses_a_unique_artifact_name_for_upload_and_deployment(self):
        workflow = Path(__file__).resolve().parents[1] / '.github/workflows/deploy-pages.yml'
        text = workflow.read_text()
        name = 'github-pages-${{ github.run_id }}-${{ github.run_attempt }}'
        self.assertIn('actions/configure-pages@', text)
        self.assertIn('actions/upload-pages-artifact@', text)
        self.assertIn('actions/deploy-pages@', text)
        self.assertIn('name: github-pages\n', text)
        self.assertIn('pages: write', text)
        self.assertIn('id-token: write', text)
        self.assertIn('name: ' + name, text)
        self.assertIn('artifact_name: ' + name, text)
