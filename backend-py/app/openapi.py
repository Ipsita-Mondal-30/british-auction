"""OpenAPI metadata for Swagger UI (/docs) and ReDoc (/redoc)."""

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from .schemas import Error

DESCRIPTION = """
REST API for a freight RFQ platform with **British (reverse) auction** bidding. Suppliers keep lowering
their quotes; a bid inside the last **X** minutes that matches the auction's trigger moves the close
**Y** minutes later, and the close never passes the **forced close** time.

## Logging in (mock auth)

Every route except `/api/health` and `/api/users` needs an `x-user-id` header. Click **Authorize**
and enter a user id from `GET /api/users`:

| id | User | Role |
|---|---|---|
| 1 | Priya Sharma | Buyer: creates RFQs, sees every quote |
| 2–5 | Rahul, Ananya, Karan, Sara | Suppliers: place bids, see only their own quotes and rank |

## Errors

Every error is `{ "error": string, "issues"?: [{ "path", "message" }] }`:
`400` validation, `401` unknown user, `403` wrong role, `404` not found,
`409` bidding closed or not started, or a duplicate reference ID.

## Live updates (Socket.IO)

Socket.IO is served on the same host at `/socket.io/` (not described by OpenAPI).

| Direction | Event | Payload |
|---|---|---|
| client → server | `join` / `leave` | `"list"` or `"rfq:<id>"` |
| server → client | `rfq:updated` | `{ "rfqId": number }` |

Broadcasts carry only the RFQ id. Clients refetch over REST with their own `x-user-id`, so role-based
visibility is enforced in one place.
"""

TAGS = [
    {'name': 'Health', 'description': 'Liveness and server time.'},
    {'name': 'Users', 'description': 'Seeded demo users for the mock login.'},
    {'name': 'RFQs', 'description': 'Create, list and inspect auctions. Responses are shaped by role.'},
    {'name': 'Bids', 'description': 'Place a bid. Runs under a per-auction row lock and may extend the close.'},
]

ERROR_EXAMPLES = {
    400: ('Validation failed', {'error': 'Forced close time must be later than bid close time',
                                'issues': [{'path': 'forcedCloseAt', 'message': 'Forced close time must be later than bid close time'}]}),
    401: ('Missing or unknown x-user-id', {'error': 'Pick a user to log in as'}),
    403: ('Wrong role for this action', {'error': 'Only buyers can do this'}),
    404: ('RFQ not found', {'error': 'RFQ not found'}),
    409: ('Conflict with the auction state', {'error': 'Bidding is closed'}),
}


def errors(*codes: int) -> dict:
    """`responses=` entries for the given error status codes."""
    return {
        code: {'model': Error, 'description': ERROR_EXAMPLES[code][0], 'content': {'application/json': {'example': ERROR_EXAMPLES[code][1]}}}
        for code in codes
    }


def install(app: FastAPI) -> None:
    """Custom schema: drops FastAPI's default 422 responses, which this API never returns (it uses 400)."""

    def openapi() -> dict:
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(title=app.title, version=app.version, description=app.description, routes=app.routes, tags=TAGS)
        for path in schema['paths'].values():
            for op in path.values():
                op.get('responses', {}).pop('422', None)
        for name in ('HTTPValidationError', 'ValidationError'):
            schema.get('components', {}).get('schemas', {}).pop(name, None)
        app.openapi_schema = schema
        return schema

    app.openapi = openapi
