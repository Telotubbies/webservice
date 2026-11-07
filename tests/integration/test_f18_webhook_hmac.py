"""F18 / security T11: webhook signature, replay window and event-id dedup (offline, no stack).

Header: X-Vissointan-Signature: t=<unix>,v1=hex(HMAC-SHA256(secret, t + "." + body)).
"""

import time
import uuid

import pytest

from app.integration import dispatcher as d
from app.integration.outbox import idem_key

SECRET = "whsec_test"
BODY = b'{"event":"shift_summary.closed","version":1}'


def test_good_signature_verifies():
    now = int(time.time())
    assert d.verify(SECRET, BODY, d.sign(SECRET, BODY, now), now=now)


def test_wrong_secret_is_refused():
    now = int(time.time())
    assert not d.verify("other", BODY, d.sign(SECRET, BODY, now), now=now)


def test_tampered_body_is_refused():
    now = int(time.time())
    assert not d.verify(SECRET, BODY + b" ", d.sign(SECRET, BODY, now), now=now)


def test_timestamp_is_bound_into_the_signature():
    now = int(time.time())
    sig = d.sign(SECRET, BODY, now)
    forged = sig.replace(f"t={now}", f"t={now + 1}")          # same v1, newer timestamp
    assert not d.verify(SECRET, BODY, forged, now=now + 1)


@pytest.mark.parametrize("age", [301, 3600, -301, -86400])
def test_stale_or_future_timestamp_is_a_replay(age):
    now = int(time.time())
    assert not d.verify(SECRET, BODY, d.sign(SECRET, BODY, now - age), now=now)


def test_window_edge_is_accepted():
    now = int(time.time())
    assert d.verify(SECRET, BODY, d.sign(SECRET, BODY, now - 300), now=now)


@pytest.mark.parametrize("header", ["", "garbage", "t=abc,v1=00", "v1=00", "t=1", "t=1,v1="])
def test_malformed_headers_never_raise(header):
    assert d.verify(SECRET, BODY, header) is False


def test_event_identity_is_stable_and_versioned():
    org = uuid.uuid4()
    a = idem_key(org, "shift_summary.closed", "dev1:2026-11-06:S1", 1)
    assert a == idem_key(org, "shift_summary.closed", "dev1:2026-11-06:S1", 1)       # a replayed event keeps its id
    assert a != idem_key(org, "shift_summary.closed", "dev1:2026-11-06:S1", 2)       # a restated total is a new event
    assert a != idem_key(uuid.uuid4(), "shift_summary.closed", "dev1:2026-11-06:S1", 1)


def test_receiver_dedup_on_event_id_rejects_second_delivery():
    """The contract the receiver follows: remember X-Vissointan-Event-Id, drop repeats."""
    seen: set[str] = set()

    def receive(event_id, header, now):
        if not d.verify(SECRET, BODY, header, now=now) or event_id in seen:
            return False
        seen.add(event_id)
        return True
    now = int(time.time())
    hdr = d.sign(SECRET, BODY, now)
    assert receive("42", hdr, now) is True
    assert receive("42", hdr, now) is False


@pytest.mark.parametrize("code,expect", [(200, "ok"), (204, "ok"), (400, "dead"), (404, "dead"), (408, "retry"),
                                          (429, "retry"), (500, "retry"), (503, "retry")])
def test_status_classification(code, expect):
    assert d.classify(code) == expect


def test_backoff_grows_then_plateaus():
    assert d.next_delay(1) < d.next_delay(3) < d.next_delay(5)
    assert d.next_delay(50) <= 21600 * 1.1


@pytest.mark.parametrize("url", ["https://127.0.0.1/hook", "https://169.254.169.254/latest", "https://10.0.0.5/x",
                                 "http://example.com/hook", "https://localhost/hook"])
def test_webhook_url_to_private_or_plain_http_is_refused(url):
    from app.core import egress
    with pytest.raises(egress.EgressError):
        egress.check_url(url, https_only=True)
