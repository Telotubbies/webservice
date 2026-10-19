-- 0050 - MFA policy (spec 2026-10-19 §4). An org can require two-factor
-- sign-in (token acr=mfa, enforced by the backend per request); API keys
-- lose command rights unless created with allow_control (step-up path).
-- Applied by 0050_mfa_policy.py as wds_owner in one transaction.

ALTER TABLE organizations ADD COLUMN mfa_required boolean NOT NULL DEFAULT false;
ALTER TABLE api_keys ADD COLUMN allow_control boolean NOT NULL DEFAULT false;
