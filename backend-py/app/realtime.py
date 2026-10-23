import re

import socketio

from . import config

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


async def rfq_updated(rfq_id: int, *rooms: str) -> None:
    """One message per client, even when it is in several of the rooms."""
    await sio.emit('rfq:updated', {'rfqId': rfq_id}, room=list(rooms))
