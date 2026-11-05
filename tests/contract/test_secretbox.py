"""Sealed data-source secrets (AES-GCM) — pure."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from cryptography.exceptions import InvalidTag  # noqa: E402

from app.datasources import secretbox


def test_round_trip():
    plain = {"password": "p@ss", "user": "ü"}
    blob = secretbox.seal(plain)
    assert isinstance(blob, bytes) and b"p@ss" not in blob
    assert secretbox.open_(blob) == plain


def test_nonce_random():
    assert secretbox.seal({"a": 1}) != secretbox.seal({"a": 1})


def test_tamper_raises_invalid_tag():
    blob = bytearray(secretbox.seal({"a": 1}))
    blob[-1] ^= 1
    with pytest.raises(InvalidTag):
        secretbox.open_(bytes(blob))


def test_wrong_key_raises_invalid_tag():
    blob = secretbox.seal({"a": 1}, key=b"\x01" * 32)
    with pytest.raises(InvalidTag):
        secretbox.open_(blob, key=b"\x02" * 32)


def test_size_cap():
    with pytest.raises(ValueError):
        secretbox.seal({"x": "a" * 5000})


def test_key_must_be_32_bytes():
    with pytest.raises(ValueError):
        secretbox.seal({"a": 1}, key=b"short")
