"""Org slug / timezone / language validation (roadmap 1.2)."""

import pytest

from app import orgs


def test_slug_normalizes_case_and_whitespace():
    assert orgs.validate_slug("  Acme-Plant ") == "acme-plant"


@pytest.mark.parametrize("bad", ["Acme Plant", "a_b_c", "acme!", "-acme", "acme-", "โรงงาน", "a--b"])
def test_slug_rejects_spaces_symbols_unicode_and_bad_hyphens(bad):
    with pytest.raises(ValueError, match="slug_format"):
        orgs.validate_slug(bad)


def test_slug_length_bounds_3_to_40():
    assert orgs.validate_slug("abc") == "abc"
    assert orgs.validate_slug("a" * 40) == "a" * 40
    for bad in ("ab", "a" * 41, ""):
        with pytest.raises(ValueError, match="slug_format"):
            orgs.validate_slug(bad)


@pytest.mark.parametrize("word", sorted(orgs.RESERVED_SLUGS))
def test_slug_rejects_reserved(word):
    with pytest.raises(ValueError, match="slug_reserved"):
        orgs.validate_slug(word)


def test_timezone_must_be_iana():
    assert orgs.validate_timezone("Asia/Bangkok") == "Asia/Bangkok"
    for bad in ("Mars/Base", "", "UTC+7", "../etc/passwd"):
        with pytest.raises(ValueError, match="timezone"):
            orgs.validate_timezone(bad)


def test_language_th_or_en_only():
    assert orgs.validate_language("th") == "th"
    with pytest.raises(ValueError, match="language"):
        orgs.validate_language("fr")
