"""
OpenAPI documentation models. They describe request and response bodies for Swagger UI and ReDoc
only: requests are validated by validation.py and responses built by serialize.py, so these never
change what the API accepts or returns.
"""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Role = Literal['BUYER', 'SUPPLIER']
TriggerType = Literal['BID_RECEIVED', 'ANY_RANK_CHANGE', 'L1_CHANGE']
Status = Literal['UPCOMING', 'ACTIVE', 'CLOSED', 'FORCE_CLOSED']
EventType = Literal['BID_PLACED', 'TIME_EXTENDED', 'EXTENSION_CAPPED']
Money = Field(description='Amount in INR as a decimal string, without trailing zeros', examples=['61500', '1234.5'])


def example(value: dict) -> ConfigDict:
    return ConfigDict(json_schema_extra={'examples': [value]})


# --- requests --------------------------------------------------------------------------------

class RfqCreate(BaseModel):
    model_config = example({
        'refId': 'RFQ-2001', 'name': 'Mumbai → Pune, 1 x 20ft container',
        'bidStartAt': '2026-11-01T09:00:00.000Z', 'bidCloseAt': '2026-11-01T12:00:00.000Z',
        'forcedCloseAt': '2026-11-01T12:30:00.000Z', 'pickupDate': '2026-11-03',
        'triggerWindowMin': 10, 'extensionMin': 5, 'triggerType': 'L1_CHANGE',
    })

    refId: str = Field(min_length=1, max_length=50, description='Unique reference ID')
    name: str = Field(min_length=1, max_length=200)
    bidStartAt: datetime = Field(description='May be in the past (bidding opens immediately)')
    bidCloseAt: datetime = Field(description='Must be after bid start and in the future')
    forcedCloseAt: datetime = Field(description='Hard cap; must be later than bid close. Extensions never pass it.')
    pickupDate: date = Field(description='On or after the forced close date')
    triggerWindowMin: int = Field(ge=1, le=1440, description='X: minutes before the current close in which activity is watched')
    extensionMin: int = Field(ge=1, le=1440, description='Y: minutes added to the close each time the trigger fires')
    triggerType: TriggerType = Field(description='What counts as activity: any bid, any rank change, or a new L1')


class BidCreate(BaseModel):
    model_config = example({
        'carrierName': 'Rapid Haul', 'freightCharges': 43050, 'originCharges': 9225, 'destinationCharges': 9225,
        'transitTimeDays': 4, 'quoteValidUntil': '2026-11-30',
    })

    carrierName: str = Field(min_length=1, max_length=100)
    freightCharges: float = Field(ge=0, le=1e9, description='INR')
    originCharges: float = Field(ge=0, le=1e9, description='INR')
    destinationCharges: float = Field(ge=0, le=1e9, description='INR')
    transitTimeDays: int = Field(ge=1, le=365)
    quoteValidUntil: date = Field(description='Not in the past')


# --- responses -------------------------------------------------------------------------------

class Health(BaseModel):
    ok: bool
    serverNow: datetime = Field(description='Server time; clients use it to correct clock skew')


class User(BaseModel):
    model_config = example({'id': 1, 'name': 'Priya Sharma', 'company': 'Acme Manufacturing', 'role': 'BUYER'})

    id: int
    name: str
    company: str
    role: Role


class Rfq(BaseModel):
    id: int
    refId: str
    name: str
    buyerId: int
    bidStartAt: datetime
    bidCloseAt: datetime = Field(description='Original close; never changes')
    currentCloseAt: datetime = Field(description='Live close; moves later on extensions, capped at forcedCloseAt')
    forcedCloseAt: datetime
    pickupDate: datetime = Field(description='Calendar date, sent as UTC midnight')
    triggerWindowMin: int
    extensionMin: int
    triggerType: TriggerType
    createdAt: datetime


class RfqListItem(Rfq):
    status: Status = Field(description='Derived from the times on every read')
    lowestBid: str | None = Money
    bidCount: int
    myRank: int | None = Field(None, description='Suppliers only: own rank, null if not bid yet')


class RfqList(BaseModel):
    serverNow: datetime
    rfqs: list[RfqListItem]


class SupplierRef(BaseModel):
    id: int
    name: str
    company: str


class BidOut(BaseModel):
    id: int
    rfqId: int
    supplierId: int
    carrierName: str
    freightCharges: str = Money
    originCharges: str = Money
    destinationCharges: str = Money
    totalAmount: str = Field(description='freight + origin + destination, INR decimal string')
    transitTimeDays: int
    quoteValidUntil: datetime = Field(description='Calendar date, sent as UTC midnight')
    createdAt: datetime = Field(description='Arrival time at the server')
    supplier: SupplierRef


class RankedBid(BidOut):
    rank: int = Field(description='1 = L1 (lowest)')


class HistoricBid(BidOut):
    current: bool = Field(description="True for each supplier's latest (live) quote; false when superseded")


class AuctionEvent(BaseModel):
    id: int
    rfqId: int
    type: EventType
    actorId: int | None = Field(None, description='Buyer view only')
    bidId: int | None = Field(None, description='Buyer view only')
    oldCloseAt: datetime | None
    newCloseAt: datetime | None
    reason: str = Field(description='Buyers see names and amounts; suppliers see competitors anonymized')
    createdAt: datetime
    mine: bool | None = Field(None, description="Supplier view only: true for the supplier's own bids")


class BuyerRef(BaseModel):
    name: str
    company: str


class RfqDetails(Rfq):
    buyer: BuyerRef
    status: Status
    lowestBid: str | None = Money
    bidCount: int
    supplierCount: int
    ranking: list[RankedBid] | None = Field(None, description="Buyer view: each supplier's latest quote, L1 first")
    allBids: list[HistoricBid] | None = Field(None, description='Buyer view: every bid ever placed, lowest first')
    myRank: int | None = Field(None, description='Supplier view')
    myBids: list[BidOut] | None = Field(None, description='Supplier view: own bids only')
    events: list[AuctionEvent] = Field(description='Activity log, oldest first')


class RfqDetailsResponse(BaseModel):
    serverNow: datetime
    rfq: RfqDetails


class Issue(BaseModel):
    path: str = Field(description='Field name, or "" for the whole body')
    message: str


class Error(BaseModel):
    error: str = Field(description='Human-readable message (the first issue, for validation errors)')
    issues: list[Issue] | None = Field(None, description='Validation errors per field (400, and 409 for a duplicate reference ID)')
