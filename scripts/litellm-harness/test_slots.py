import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

from slots import shared_slot


class SlotTests(unittest.TestCase):
    def test_waiting_processes_get_slots_in_order_and_dead_leases_clear(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            processes = []
            script = '''
from slots import shared_slot
from pathlib import Path
import sys,time
root=Path(sys.argv[1]);name=sys.argv[2]
with shared_slot(root,1):
 with (root/'order').open('a') as output:output.write(name+'\\n')
 while not (root/('release-'+name)).exists():time.sleep(0.02)
'''
            def start(name):
                env = {**os.environ, 'PYTHONPATH': str(Path(__file__).parent.resolve())}
                child = subprocess.Popen([sys.executable, '-c', script, str(root), name], env=env)
                processes.append(child)
                return child
            def wait_for(condition):
                deadline = time.monotonic() + 5
                while not condition() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(condition())
            def order():
                return (root / 'order').read_text().splitlines() if (root / 'order').exists() else []
            try:
                blocker = start('blocker')
                wait_for(lambda: order() == ['blocker'])
                # Stale earlier ticket must not block live waiters.
                (root / 'queue' / '00000000000000000000-stale.ticket').touch()
                first = start('first')
                wait_for(lambda: len(list((root / 'queue').glob('*.ticket'))) == 1
                         and not (root / 'queue' / '00000000000000000000-stale.ticket').exists())
                second = start('second')
                wait_for(lambda: len(list((root / 'queue').glob('*.ticket'))) == 2)
                # A crashed holder releases its kernel lock without cleanup.
                blocker.kill(); blocker.wait(timeout=5)
                wait_for(lambda: order() == ['blocker', 'first'])
                (root / 'release-first').touch(); first.wait(timeout=5)
                wait_for(lambda: order() == ['blocker', 'first', 'second'])
                (root / 'release-second').touch(); second.wait(timeout=5)
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.kill(); process.wait(timeout=5)

    def test_exception_releases_slot_and_ticket(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(RuntimeError, 'test failure'):
                with shared_slot(temporary, 1):
                    raise RuntimeError('test failure')
            with shared_slot(temporary, 1):
                self.assertEqual(list((Path(temporary) / 'queue').glob('*.ticket')), [])


if __name__ == '__main__':
    unittest.main()
