"""Web Push (spec 2026-10-19 §8): RFC 8291 encryption against the RFC's own
example, VAPID (RFC 8292) signature, endpoint policy, and that the message a
push service sees carries no plant data."""

import json
import time

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from app.alarming import push, webpush as W

# RFC 8291 §5 / Appendix A example
AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"
AS_PUBLIC = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"
UA_PUBLIC = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
AUTH = "BTBZMqHH6r4Tts7J_aSIgg"
SALT = "DGv6ra1nlYgDCS1FRnbzlw"
PLAINTEXT = b"When I grow up, I want to be a watermelon"


def _key(b64):
    return ec.derive_private_key(int.from_bytes(W.b64d(b64), "big"), ec.SECP256R1())


def test_rfc8291_example_intermediate_values_and_body():
    as_priv = _key(AS_PRIVATE)
    assert W.b64e(W.public_bytes(as_priv)) == AS_PUBLIC
    ua_pub, auth, salt = W.b64d(UA_PUBLIC), W.b64d(AUTH), W.b64d(SALT)
    secret = as_priv.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(
        ec.SECP256R1(), ua_pub))
    assert W.b64e(secret) == "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs"
    ikm = W._hkdf(auth, secret, b"WebPush: info\x00" + ua_pub + W.public_bytes(as_priv), 32)
    assert W.b64e(ikm) == "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg"
    assert W.b64e(W._hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)) == "oIhVW04MRdy2XN9CiKLxTg"
    assert W.b64e(W._hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)) == "4h_95klXJ5E_qnoN"
    body = W.b64e(W.encrypt(PLAINTEXT, ua_pub, auth, as_private=as_priv, salt=salt))
    assert body.startswith("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZII"
                           "gDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztL"
                           "VBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")


def test_round_trip_with_a_fresh_key():
    ua = ec.generate_private_key(ec.SECP256R1())
    auth = b"0123456789abcdef"
    msg = json.dumps({"title": "Alarm", "body": "มี alarm ใหม่"}).encode()
    body = W.encrypt(msg, W.public_bytes(ua), auth)
    assert W.decrypt(body, ua, auth) == msg
    assert W.encrypt(msg, W.public_bytes(ua), auth) != body        # fresh salt + key each time


def test_encrypt_rejects_bad_input():
    ua = W.public_bytes(ec.generate_private_key(ec.SECP256R1()))
    with pytest.raises(ValueError):
        W.encrypt(b"x" * (W.MAX_PAYLOAD + 1), ua, b"0" * 16)
    with pytest.raises(ValueError):
        W.encrypt(b"x", ua[:-1], b"0" * 16)
    with pytest.raises(ValueError):
        W.encrypt(b"x", ua, b"short")
    assert W.encrypt(b"x" * W.MAX_PAYLOAD, ua, b"0" * 16)          # exactly at the limit fits one record


def test_vapid_header_verifies_with_the_advertised_public_key():
    ep = "https://fcm.googleapis.com/fcm/send/abc"
    h = W.vapid_authorization(ep, "mailto:ops@example.com", now=1_000_000)
    assert h.startswith("vapid t=")
    jwt, k = h[len("vapid t="):].split(",k=")
    head, claims, sig = jwt.split(".")
    assert json.loads(W.b64d(head)) == {"typ": "JWT", "alg": "ES256"}
    c = json.loads(W.b64d(claims))
    assert c == {"aud": "https://fcm.googleapis.com", "exp": 1_000_000 + W.VAPID_TTL_S,
                 "sub": "mailto:ops@example.com"}
    raw = W.b64d(sig)
    assert len(raw) == 64
    pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), W.b64d(k))
    pub.verify(encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")),
               f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256()))   # raises if wrong
    assert k == W.vapid_public_key_b64()


def test_vapid_key_is_stable_and_valid():
    a, b = W.vapid_private_key(), W.vapid_private_key()
    assert W.public_bytes(a) == W.public_bytes(b)
    assert len(W.public_bytes(a)) == 65 and W.public_bytes(a)[0] == 4


@pytest.mark.parametrize("url,ok", [
    ("https://fcm.googleapis.com/fcm/send/xyz", True),
    ("https://updates.push.services.mozilla.com/wpush/v2/abc", True),
    ("https://web.push.apple.com/QWERTY", True),
    ("https://wns2-par02p.notify.windows.com/w/?token=x", True),
    ("http://fcm.googleapis.com/fcm/send/xyz", False),            # not https
    ("https://fcm.googleapis.com.evil.example/x", False),         # suffix trick
    ("https://evilfcm.googleapis.com.example/x", False),
    ("https://169.254.169.254/latest/meta-data", False),          # cloud metadata
    ("https://localhost/x", False),
    ("https://user:pw@fcm.googleapis.com/x", False),
    ("https://fcm.googleapis.com:8443/x", False),
    ("ftp://fcm.googleapis.com/x", False),
    ("not a url", False),
    ("", False),
])
def test_endpoint_allowlist(url, ok):
    assert W.endpoint_allowed(url) is ok


def test_build_request_headers():
    ua = ec.generate_private_key(ec.SECP256R1())
    sub = {"endpoint": "https://fcm.googleapis.com/fcm/send/abc",
           "p256dh": W.b64e(W.public_bytes(ua)), "auth": W.b64e(b"0123456789abcdef")}
    url, body, h = W.build_request(sub, {"title": "t"}, "mailto:a@b.co", urgency="high", ttl=60)
    assert url == sub["endpoint"] and h["Content-Encoding"] == "aes128gcm"
    assert h["TTL"] == "60" and h["Urgency"] == "high" and h["Authorization"].startswith("vapid t=")
    assert json.loads(W.decrypt(body, ua, b"0123456789abcdef")) == {"title": "t"}


# ── what the push service gets to see ────────────────────────────────────

def test_message_has_no_plant_data():
    import uuid
    aid = uuid.uuid4()
    for loc in ("en", "th"):
        for kind in ("raised", "escalation", "test"):
            m = push.build_message(loc, kind, "critical", "Mixing area", aid)
            assert set(m) <= {"title", "body", "url", "kind", "tag"}
            assert m["url"] == f"/alarms?id={aid}" and m["tag"] == str(aid)
            text = json.dumps(m, ensure_ascii=False)
            assert "plant1" not in text and "/" not in m["body"]


def test_message_text_matches_the_spec_wording():
    m = push.build_message("en", "raised", "critical", "Mixing area", None)
    assert m["body"] == "New critical alarm in Mixing area"
    th = push.build_message("th", "raised", "critical", "พื้นที่ผสม", None)
    assert th["body"] == "มี alarm ระดับ วิกฤต ใหม่ที่ พื้นที่ผสม"
    assert push.build_message("en", "raised", None, None, None)["body"] == "New warning alarm in the plant"
    assert push.build_message("fr", "raised", "info", "X", None)["body"].startswith("New info")   # unknown locale -> en
    assert push.build_message("en", "raised", "critical", "X", None)["url"] == "/alarms"


def test_only_raise_and_escalation_notify():
    assert set(push.PUSH_EVENTS) == {"raised", "escalation"}


def test_notify_knows_the_webpush_channel_type():
    from app.alarming import notify
    assert "webpush" in notify.CHANNEL_TYPES
    pub, sec = notify._split_config("webpush", {"junk": 1}, {"x": "y"})
    assert pub == {} and sec == {}


# ── delivery against fakes ───────────────────────────────────────────────

import asyncio
import uuid


class FakeTC:
    org_id = uuid.uuid4()

    def __init__(self, rows=None):
        self.rows, self.sql = rows or [], []

    async def execute(self, sql, *args):
        self.sql.append((sql, args))

    async def fetch(self, sql, *args):
        self.sql.append((sql, args))
        return self.rows

    async def fetchrow(self, sql, *args):
        return {"severity": "critical", "area": "Mixing"}


def _sub(locale="en"):
    ua = ec.generate_private_key(ec.SECP256R1())
    return {"id": uuid.uuid4(), "endpoint": "https://fcm.googleapis.com/fcm/send/" + uuid.uuid4().hex,
            "p256dh": W.b64e(W.public_bytes(ua)), "auth": W.b64e(b"0123456789abcdef"), "locale": locale}


def _run(coro):
    return asyncio.run(coro)


def test_deliver_marks_success_and_deletes_gone_subscriptions(monkeypatch):
    codes = iter([201, 410, 503])
    posted = []

    async def fake_post(url, body, headers):
        posted.append((url, headers["Urgency"]))
        return next(codes)
    monkeypatch.setattr(push, "_post", fake_post)
    subs = [_sub("en"), _sub("th"), _sub("en")]
    tc = FakeTC()
    sent, failed = _run(push.deliver(tc, subs, "raised", "critical", "Mixing", uuid.uuid4()))
    assert (sent, failed) == (1, 1)
    kinds = [s.split()[0] + " " + s.split()[1] for s, _ in tc.sql]
    assert any(s.startswith("UPDATE push_subscriptions SET last_ok_at") for s, _ in tc.sql)
    deleted = [a[0] for s, a in tc.sql if s.startswith("DELETE FROM push_subscriptions")]
    assert deleted == [subs[1]["id"]]                      # 410: the browser dropped it
    assert [h for _, h in posted] == ["high", "high", "high"]


def test_deliver_survives_a_broken_subscription(monkeypatch):
    async def fake_post(url, body, headers):
        return 201
    monkeypatch.setattr(push, "_post", fake_post)
    bad = {**_sub(), "p256dh": "AAAA"}
    sent, failed = _run(push.deliver(FakeTC(), [bad, _sub()], "raised", None, None, None))
    assert (sent, failed) == (1, 1)


def test_deliver_encrypts_per_subscriber_in_their_language(monkeypatch):
    got = {}

    async def fake_post(url, body, headers):
        got[url] = body
        return 201
    monkeypatch.setattr(push, "_post", fake_post)
    ua_en = ec.generate_private_key(ec.SECP256R1())
    ua_th = ec.generate_private_key(ec.SECP256R1())
    mk = lambda k, loc: {**_sub(loc), "p256dh": W.b64e(W.public_bytes(k))}  # noqa: E731
    s_en, s_th = mk(ua_en, "en"), mk(ua_th, "th")
    _run(push.deliver(FakeTC(), [s_en, s_th], "raised", "critical", "Mixing", None))
    en = json.loads(W.decrypt(got[s_en["endpoint"]], ua_en, b"0123456789abcdef"))
    th = json.loads(W.decrypt(got[s_th["endpoint"]], ua_th, b"0123456789abcdef"))
    assert en["body"] == "New critical alarm in Mixing"
    assert th["body"] == "มี alarm ระดับ วิกฤต ใหม่ที่ Mixing"
    # a device can only read its own message
    with pytest.raises(Exception):
        W.decrypt(got[s_en["endpoint"]], ua_th, b"0123456789abcdef")


def test_channel_skips_clear_events_and_raises_when_every_send_fails(monkeypatch):
    ch = {"team_id": None}
    assert _run(push.send_for_channel(FakeTC(), ch, "cleared", uuid.uuid4())) == "skipped"
    assert _run(push.send_for_channel(FakeTC(), ch, "vision", None)) == "skipped"

    async def refuse(url, body, headers):
        return 503
    monkeypatch.setattr(push, "_post", refuse)
    with pytest.raises(RuntimeError):
        _run(push.send_for_channel(FakeTC([_sub()]), ch, "raised", uuid.uuid4()))

    async def accept(url, body, headers):
        return 201
    monkeypatch.setattr(push, "_post", accept)
    assert _run(push.send_for_channel(FakeTC([_sub(), _sub()]), ch, "escalation", uuid.uuid4())) == "2/2 device(s)"
    assert _run(push.send_for_channel(FakeTC([]), ch, "raised", None)) == "0/0 device(s)"


def test_post_refuses_non_https_and_private_targets():
    with pytest.raises(Exception):
        _run(push._post("http://fcm.googleapis.com/x", b"", {}))
    with pytest.raises(Exception):
        _run(push._post("https://127.0.0.1/x", b"", {}))
