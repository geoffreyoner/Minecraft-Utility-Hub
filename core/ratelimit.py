import time
from collections import defaultdict


def client_ip(request):
    return request.headers.get("x-real-ip") or request.remote_addr or "unknown"


def make_limiter(limit, window):
    hits = defaultdict(list)

    def _ok(key):
        now = time.time()
        bucket = hits[key]
        bucket[:] = [t for t in bucket if now - t < window]

        # shortcut: limit in-memory per instance, belum lintas instance.
        # Upgrade ke store bersama (Redis) kalau trafik naik / multi-instance.
        if len(hits) > 10000:
            for k in [k for k, v in hits.items()
                      if k != key and (not v or now - v[-1] >= window)]:
                hits.pop(k, None)

        if len(bucket) >= limit:
            return False
        bucket.append(now)
        return True

    return _ok
