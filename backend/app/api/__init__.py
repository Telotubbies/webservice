"""v2 admin routers, mounted by main.py."""

from .alarm_rules import router as alarm_rules_router
from .api_keys import router as api_keys_router
from .audit import router as audit_router
from .dashboards import router as dashboards_router
from .downtimes import router as downtimes_router
from .incidents import router as incidents_router
from .members import router as members_router
from .slos import router as slos_router

routers = (alarm_rules_router, api_keys_router, audit_router, dashboards_router, downtimes_router, incidents_router, members_router, slos_router)
