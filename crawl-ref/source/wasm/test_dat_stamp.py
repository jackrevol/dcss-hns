import importlib.util
import os
from pathlib import Path
import shutil
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("dat_stamp", Path(__file__).with_name("dat-stamp.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DataStampTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.source = Path(self.temporary.name) / "source"
        (self.source / "dat/des").mkdir(parents=True)
        (self.source / "dat/tiles").mkdir()
        (self.source.parent / "docs").mkdir()
        (self.source / "dat/des/test.des").write_text("NAME: test\n")
        (self.source.parent / "docs/help.txt").write_text("help")

    def test_checkout_location_and_timestamps_do_not_invalidate_cache(self):
        before = module.data_stamp(self.source)
        with tempfile.TemporaryDirectory() as copied:
            shutil.copytree(self.source.parent, Path(copied) / "checkout")
            source = Path(copied) / "checkout/source"
            for path in source.parent.rglob("*"):
                os.utime(path, (1000, 2000))
            self.assertEqual(module.data_stamp(source), before)

    def test_content_change_with_preserved_timestamp_invalidates_cache(self):
        before = module.data_stamp(self.source)
        path = self.source / "dat/des/test.des"
        stamp = path.stat()
        path.write_text("NAME: changed\n")
        os.utime(path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
        self.assertNotEqual(module.data_stamp(self.source), before)

    def test_file_add_remove_and_rename_invalidate_cache(self):
        before = module.data_stamp(self.source)
        path = self.source / "dat/des/extra.des"
        path.write_text("extra")
        self.assertNotEqual(module.data_stamp(self.source), before)
        path.unlink()
        self.assertEqual(module.data_stamp(self.source), before)
        (self.source / "dat/des/test.des").rename(path)
        self.assertNotEqual(module.data_stamp(self.source), before)

    def test_docs_change_invalidates_cache_and_excluded_tiles_do_not(self):
        before = module.data_stamp(self.source)
        (self.source / "dat/tiles/test.png").write_bytes(b"tile")
        self.assertEqual(module.data_stamp(self.source), before)
        (self.source.parent / "docs/help.txt").write_text("new help")
        self.assertNotEqual(module.data_stamp(self.source), before)

    def test_stamp_fits_runtime_cache_and_javascript_integer(self):
        stamp = module.data_stamp(self.source)
        self.assertGreater(stamp, 0)
        self.assertLess(stamp, 2 ** 48)
        self.assertLess(len(":" + str(stamp)), 20)


if __name__ == "__main__":
    unittest.main()
