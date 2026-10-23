import re

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config, errors
from .routes import router

app = FastAPI(title='British Auction RFQ API')
app.add_middleware(CORSMiddleware, allow_origins=config.FRONTEND_ORIGINS, allow_methods=['*'], allow_headers=['*'])
errors.register(app)
app.include_router(router)

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins=config.FRONTEND_ORIGINS)
ROOM = re.compile(r'^(list|rfq:\d+)$')


# Clients join `list` (listing page) or `rfq:<id>` (details page). Broadcasts carry only the
# RFQ id; clients refetch over REST so role-based visibility is enforced in one place.
@sio.on('join')
async def join(sid, room):
    if isinstance(room, str) and ROOM.match(room):
        await sio.enter_room(sid, room)


@sio.on('leave')
async def leave(sid, room):
    if isinstance(room, str):
        await sio.leave_room(sid, room)


# Socket.IO answers on /socket.io/ (same path as the Node server); everything else goes to FastAPI.
asgi = socketio.ASGIApp(sio, other_asgi_app=app)
