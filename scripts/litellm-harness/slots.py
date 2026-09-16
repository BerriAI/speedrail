"""Fair local-process slots shared by replay controllers and datasets."""
from contextlib import contextmanager
import fcntl
from pathlib import Path
import time
from uuid import uuid4


@contextmanager
def shared_slot(directory, capacity):
    directory = Path(directory)
    queue = directory / 'queue'
    queue.mkdir(parents=True, exist_ok=True)
    # The lease is held while waiting. A dead process releases it automatically,
    # so another controller can remove stale tickets without trusting PIDs.
    with (directory / 'queue.lock').open('a') as coordinator:
        fcntl.flock(coordinator, fcntl.LOCK_EX)
        ticket = queue / f'{time.monotonic_ns():020d}-{uuid4().hex}.ticket'
        lease = ticket.open('x')
        fcntl.flock(lease, fcntl.LOCK_EX)
    acquired = None
    try:
        while acquired is None:
            with (directory / 'queue.lock').open('a') as coordinator:
                fcntl.flock(coordinator, fcntl.LOCK_EX)
                live = []
                for candidate in sorted(queue.glob('*.ticket')):
                    if candidate == ticket:
                        live.append(candidate)
                        continue
                    with candidate.open('a') as probe:
                        try:
                            fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        except BlockingIOError:
                            live.append(candidate)
                        else:
                            candidate.unlink()
                if live and live[0] == ticket:
                    for index in range(capacity):
                        lock = (directory / f'slot-{index}.lock').open('a')
                        try:
                            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        except BlockingIOError:
                            lock.close()
                        else:
                            acquired = lock
                            ticket.unlink()
                            break
            if acquired is None:
                time.sleep(0.2)
        yield
    finally:
        if acquired is not None:
            acquired.close()
        with (directory / 'queue.lock').open('a') as coordinator:
            fcntl.flock(coordinator, fcntl.LOCK_EX)
            ticket.unlink(missing_ok=True)
            lease.close()
