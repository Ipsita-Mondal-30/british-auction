from collections.abc import AsyncIterator
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from . import config


def async_url(url: str) -> tuple[str, dict]:
    """
    Turns a plain postgresql:// URL (what Render and .env provide) into one for asyncpg.
    asyncpg takes `ssl` as a connect argument rather than libpq's `sslmode` query parameter.
    """
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query))
    connect_args = {}
    if 'sslmode' in query:
        connect_args['ssl'] = query.pop('sslmode')
    scheme = 'postgresql+asyncpg'
    return urlunsplit((scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)), connect_args


url, connect_args = async_url(config.DATABASE_URL)
engine = create_async_engine(url, connect_args=connect_args, pool_pre_ping=True)
Session = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with Session() as session:
        yield session
