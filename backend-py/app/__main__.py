import uvicorn

from . import config

# `python -m app` runs the dev server with auto-reload.
uvicorn.run('app.main:asgi', host='0.0.0.0', port=config.PORT, reload=True)
