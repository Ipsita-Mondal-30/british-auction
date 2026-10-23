from fastapi import APIRouter

from .timefmt import iso, now

router = APIRouter(prefix='/api')


@router.get('/health')
async def health():
    return {'ok': True, 'serverNow': iso(now())}
