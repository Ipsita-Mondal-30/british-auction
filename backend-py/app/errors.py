import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

log = logging.getLogger('app')


class HttpError(Exception):
    def __init__(self, status: int, message: str, issues: list[dict] | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.issues = issues


def register(app: FastAPI) -> None:
    """Every error is `{ error, issues? }`, the shape the frontend reads field errors from."""

    @app.exception_handler(HttpError)
    async def http_error(_req: Request, e: HttpError):
        body = {'error': e.message}
        if e.issues is not None:
            body['issues'] = e.issues
        return JSONResponse(body, status_code=e.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_req: Request, e: RequestValidationError):
        errors = e.errors()
        if any(err.get('type') == 'json_invalid' for err in errors):
            return JSONResponse({'error': 'Invalid JSON body'}, status_code=400)
        issues = [{'path': '.'.join(str(p) for p in err['loc'][1:]), 'message': err['msg']} for err in errors]
        return JSONResponse({'error': issues[0]['message'], 'issues': issues}, status_code=400)

    @app.exception_handler(Exception)
    async def unexpected(_req: Request, e: Exception):
        log.exception(e)
        return JSONResponse({'error': 'Something went wrong'}, status_code=500)
