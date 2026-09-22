import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).resolve().parents[1] / 'tools/publish-chrome.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class Publishing(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {name: 'fixture' for name in ('CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN')})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.archive = tempfile.NamedTemporaryFile()
        self.archive.write(b'fixture')
        self.archive.flush()
        self.addCleanup(self.archive.close)

    def test_pending_review_is_not_published(self):
        with patch.object(publisher, 'request', side_effect=[{'access_token': 'fixture'}, {'uploadState': 'SUCCESS'}, {'status': ['ITEM_PENDING_REVIEW']}]) as request:
            self.assertEqual(publisher.publish(self.archive.name), 'Pending Chrome Web Store review')
            self.assertIn(publisher.ITEM_ID, request.call_args.args[0])

    def test_failed_upload_never_publishes(self):
        with patch.object(publisher, 'request', side_effect=[{'access_token': 'fixture'}, {'uploadState': 'FAILURE'}]) as request:
            with self.assertRaises(RuntimeError):
                publisher.publish(self.archive.name)
            self.assertEqual(request.call_count, 2)

    def test_async_upload_is_polled(self):
        with patch.object(publisher, 'time'), patch.object(publisher, 'request', side_effect=[{'access_token': 'fixture'}, {'uploadState': 'IN_PROGRESS'}, {'uploadState': 'SUCCESS'}, {'status': ['OK']}]) as request:
            self.assertIn('accepted', publisher.publish(self.archive.name))
            self.assertEqual(request.call_args_list[2].args[1], 'GET')

    def test_mixed_failure_status_is_rejected(self):
        with patch.object(publisher, 'request', side_effect=[{'access_token': 'fixture'}, {'uploadState': 'SUCCESS'}, {'status': ['OK', 'NOT_AUTHORIZED']}]):
            with self.assertRaises(RuntimeError):
                publisher.publish(self.archive.name)

    def test_store_validation_error_is_reported(self):
        import io
        from urllib.error import HTTPError
        error = HTTPError(publisher.ITEM_URL, 400, 'Bad Request', {},
                          io.BytesIO(b'{"error":{"message":"Permission justification required"}}'))
        with patch.object(publisher, 'urlopen', side_effect=error):
            with self.assertRaisesRegex(RuntimeError, 'Permission justification required'):
                publisher.request(publisher.ITEM_URL, 'POST')
