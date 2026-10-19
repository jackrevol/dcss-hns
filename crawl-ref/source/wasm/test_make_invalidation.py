import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class MakeInvalidationTest(unittest.TestCase):
    def test_data_content_recompiles_only_files_object(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            (source / "wasm").mkdir(parents=True)
            (source / "dat").mkdir()
            (root / "docs").mkdir()
            for name in ["Makefile.emscripten", "dat-stamp.py"]:
                shutil.copyfile(Path(__file__).with_name(name), source / "wasm" / name)
            (source / "wasm/objects.txt").write_text("files.o other.o\n")
            (source / "wasm/pre.js").write_text("")
            (source / "files.cc").write_text("")
            (source / "other.cc").write_text("")
            data = source / "dat/game.txt"
            data.write_text("first")
            log = root / "compile.jsonl"
            compiler = root / "compiler"
            compiler.write_text("""#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
with open(os.environ['HNS_TEST_COMPILE_LOG'], 'a') as log:
    log.write(json.dumps(args) + '\\n')
pathlib.Path(args[args.index('-o') + 1]).write_text('compiled')
""")
            compiler.chmod(0o755)

            def build():
                log.write_text("")
                subprocess.run(["make", "-f", "wasm/Makefile.emscripten",
                                "CXX=" + str(compiler), "CC=" + str(compiler)],
                               cwd=source, check=True, capture_output=True,
                               env={**os.environ, "HNS_TEST_COMPILE_LOG": str(log)})
                return [json.loads(line) for line in log.read_text().splitlines()]

            first = build()
            files = next(args for args in first if "files.cc" in args)
            other = next(args for args in first if "other.cc" in args)
            self.assertTrue(any(arg.startswith("-DPOCKETZOT_DAT_STAMP=") for arg in files))
            self.assertFalse(any(arg.startswith("-DPOCKETZOT_DAT_STAMP=") for arg in other))
            os.utime(data, (1000, 2000))
            self.assertEqual(build(), [])
            data.write_text("second")
            os.utime(data, (1000, 2000))
            stamp = source / "wasm/build/dat-stamp"
            before_query = stamp.read_text()
            query = subprocess.run(["make", "-q", "-f", "wasm/Makefile.emscripten"],
                                   cwd=source, capture_output=True)
            self.assertEqual(query.returncode, 1)
            self.assertEqual(stamp.read_text(), before_query)
            changed = build()
            self.assertEqual(len(changed), 2)  # files.o와 최종 링크만 실행합니다.
            self.assertTrue(any("files.cc" in args for args in changed))
            self.assertFalse(any("other.cc" in args for args in changed))


if __name__ == "__main__":
    unittest.main()
