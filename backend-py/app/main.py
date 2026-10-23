import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config, errors
from .realtime import sio
from .routes import router

app = FastAPI(title='British Auction RFQ API')
app.add_middleware(CORSMiddleware, allow_origins=config.FRONTEND_ORIGINS, allow_methods=['*'], allow_headers=['*'])
errors.register(app)
app.include_router(router)

# Socket.IO answers on /socket.io/ (the path socket.io-client expects); everything else goes to FastAPI.
asgi = socketio.ASGIApp(sio, other_asgi_app=app)
