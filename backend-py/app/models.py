"""
SQLAlchemy models. Table and column names are camelCase because the original Node/Prisma version of
the API created the schema; keeping it unchanged means existing databases need no data migration.
"""

from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, Integer, Numeric, Text, TypeDecorator, func
from sqlalchemy.dialects.postgresql import ENUM, TIMESTAMP
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .auction import to_cents


class UTCDateTime(TypeDecorator):
    """TIMESTAMP(3) without time zone, holding UTC. Aware datetimes in Python."""

    impl = TIMESTAMP(precision=3)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, _dialect):
        return value.astimezone(timezone.utc).replace(tzinfo=None) if value is not None else None

    def process_result_value(self, value: datetime | None, _dialect):
        return value.replace(tzinfo=timezone.utc) if value is not None else None


# The enum types already exist (created by the initial migration), so never create them here.
Role = ENUM('BUYER', 'SUPPLIER', name='Role', create_type=False)
TriggerType = ENUM('BID_RECEIVED', 'ANY_RANK_CHANGE', 'L1_CHANGE', name='TriggerType', create_type=False)
EventType = ENUM('BID_PLACED', 'TIME_EXTENDED', 'EXTENSION_CAPPED', name='EventType', create_type=False)
Money = Numeric(12, 2, asdecimal=True)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = 'User'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    company: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Role)


class Rfq(Base):
    __tablename__ = 'Rfq'
    __table_args__ = (
        Index('Rfq_refId_key', 'refId', unique=True),
        # Database-level invariants (migration 0002); the API validates the same rules first.
        CheckConstraint('"bidCloseAt" > "bidStartAt"', name='rfq_close_after_start'),
        CheckConstraint('"forcedCloseAt" > "bidCloseAt"', name='rfq_forced_after_close'),
        CheckConstraint('"currentCloseAt" >= "bidCloseAt" AND "currentCloseAt" <= "forcedCloseAt"', name='rfq_current_close_within_cap'),
        CheckConstraint('"triggerWindowMin" BETWEEN 1 AND 1440', name='rfq_trigger_window_range'),
        CheckConstraint('"extensionMin" BETWEEN 1 AND 1440', name='rfq_extension_range'),
        CheckConstraint('length(btrim("refId")) > 0', name='rfq_ref_id_not_blank'),
        CheckConstraint('length(btrim("name")) > 0', name='rfq_name_not_blank'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ref_id: Mapped[str] = mapped_column('refId', Text)
    name: Mapped[str] = mapped_column(Text)
    buyer_id: Mapped[int] = mapped_column('buyerId', ForeignKey('User.id', ondelete='RESTRICT', onupdate='CASCADE'))
    bid_start_at: Mapped[datetime] = mapped_column('bidStartAt', UTCDateTime)
    bid_close_at: Mapped[datetime] = mapped_column('bidCloseAt', UTCDateTime)  # original close, never changes
    current_close_at: Mapped[datetime] = mapped_column('currentCloseAt', UTCDateTime)  # moves on extensions, capped at forced
    forced_close_at: Mapped[datetime] = mapped_column('forcedCloseAt', UTCDateTime)
    pickup_date: Mapped[date] = mapped_column('pickupDate', Date)
    trigger_window_min: Mapped[int] = mapped_column('triggerWindowMin', Integer)  # X
    extension_min: Mapped[int] = mapped_column('extensionMin', Integer)  # Y
    trigger_type: Mapped[str] = mapped_column('triggerType', TriggerType)
    created_at: Mapped[datetime] = mapped_column('createdAt', UTCDateTime, server_default=func.current_timestamp())

    buyer: Mapped[User] = relationship()
    bids: Mapped[list['Bid']] = relationship(back_populates='rfq', order_by='Bid.id')
    events: Mapped[list['AuctionEvent']] = relationship(back_populates='rfq', order_by='AuctionEvent.id')


class Bid(Base):
    __tablename__ = 'Bid'
    __table_args__ = (
        Index('Bid_rfqId_supplierId_createdAt_idx', 'rfqId', 'supplierId', 'createdAt'),
        CheckConstraint('"freightCharges" >= 0 AND "originCharges" >= 0 AND "destinationCharges" >= 0', name='bid_charges_non_negative'),
        CheckConstraint('"totalAmount" = "freightCharges" + "originCharges" + "destinationCharges"', name='bid_total_is_sum_of_charges'),
        CheckConstraint('"totalAmount" > 0', name='bid_total_positive'),
        CheckConstraint('"transitTimeDays" BETWEEN 1 AND 365', name='bid_transit_range'),
        CheckConstraint('length(btrim("carrierName")) > 0', name='bid_carrier_not_blank'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rfq_id: Mapped[int] = mapped_column('rfqId', ForeignKey('Rfq.id', ondelete='RESTRICT', onupdate='CASCADE'))
    supplier_id: Mapped[int] = mapped_column('supplierId', ForeignKey('User.id', ondelete='RESTRICT', onupdate='CASCADE'))
    carrier_name: Mapped[str] = mapped_column('carrierName', Text)
    freight_charges: Mapped[Decimal] = mapped_column('freightCharges', Money)
    origin_charges: Mapped[Decimal] = mapped_column('originCharges', Money)
    destination_charges: Mapped[Decimal] = mapped_column('destinationCharges', Money)
    total_amount: Mapped[Decimal] = mapped_column('totalAmount', Money)
    transit_time_days: Mapped[int] = mapped_column('transitTimeDays', Integer)
    quote_valid_until: Mapped[date] = mapped_column('quoteValidUntil', Date)
    created_at: Mapped[datetime] = mapped_column('createdAt', UTCDateTime, server_default=func.current_timestamp())

    rfq: Mapped[Rfq] = relationship(back_populates='bids')
    supplier: Mapped[User] = relationship()

    @property
    def total_cents(self) -> int:
        """Integer cents, so ranking compares exact amounts (see auction.rank)."""
        return to_cents(self.total_amount)


class AuctionEvent(Base):
    """Append-only activity log."""

    __tablename__ = 'AuctionEvent'
    __table_args__ = (
        Index('AuctionEvent_rfqId_createdAt_idx', 'rfqId', 'createdAt'),
        CheckConstraint(
            'type <> \'TIME_EXTENDED\' OR ("oldCloseAt" IS NOT NULL AND "newCloseAt" IS NOT NULL AND "newCloseAt" > "oldCloseAt")',
            name='event_extension_moves_close_later',
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rfq_id: Mapped[int] = mapped_column('rfqId', ForeignKey('Rfq.id', ondelete='RESTRICT', onupdate='CASCADE'))
    type: Mapped[str] = mapped_column(EventType)
    actor_id: Mapped[int | None] = mapped_column('actorId', ForeignKey('User.id', ondelete='SET NULL', onupdate='CASCADE'))
    bid_id: Mapped[int | None] = mapped_column('bidId', ForeignKey('Bid.id', ondelete='SET NULL', onupdate='CASCADE'))
    old_close_at: Mapped[datetime | None] = mapped_column('oldCloseAt', UTCDateTime)
    new_close_at: Mapped[datetime | None] = mapped_column('newCloseAt', UTCDateTime)
    reason: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column('createdAt', UTCDateTime, server_default=func.current_timestamp())

    rfq: Mapped[Rfq] = relationship(back_populates='events')
