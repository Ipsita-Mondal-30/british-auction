"""CHECK constraints for timestamp order and money invariants.

The API already validates all of these; the database enforces them too, so no write path
(a script, a manual fix, a future service) can store an invalid auction or bid.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-23
"""

from alembic import op

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None

CONSTRAINTS = [
    # Rfq: schedule order, the forced-close cap, configuration ranges
    ('Rfq', 'rfq_close_after_start', '"bidCloseAt" > "bidStartAt"'),
    ('Rfq', 'rfq_forced_after_close', '"forcedCloseAt" > "bidCloseAt"'),
    ('Rfq', 'rfq_current_close_within_cap', '"currentCloseAt" >= "bidCloseAt" AND "currentCloseAt" <= "forcedCloseAt"'),
    ('Rfq', 'rfq_trigger_window_range', '"triggerWindowMin" BETWEEN 1 AND 1440'),
    ('Rfq', 'rfq_extension_range', '"extensionMin" BETWEEN 1 AND 1440'),
    ('Rfq', 'rfq_ref_id_not_blank', 'length(btrim("refId")) > 0'),
    ('Rfq', 'rfq_name_not_blank', 'length(btrim("name")) > 0'),
    # Bid: money invariants and ranges
    ('Bid', 'bid_charges_non_negative', '"freightCharges" >= 0 AND "originCharges" >= 0 AND "destinationCharges" >= 0'),
    ('Bid', 'bid_total_is_sum_of_charges', '"totalAmount" = "freightCharges" + "originCharges" + "destinationCharges"'),
    ('Bid', 'bid_total_positive', '"totalAmount" > 0'),
    ('Bid', 'bid_transit_range', '"transitTimeDays" BETWEEN 1 AND 365'),
    ('Bid', 'bid_carrier_not_blank', 'length(btrim("carrierName")) > 0'),
    # AuctionEvent: an extension always moves the close later
    ('AuctionEvent', 'event_extension_moves_close_later',
     'type <> \'TIME_EXTENDED\' OR ("oldCloseAt" IS NOT NULL AND "newCloseAt" IS NOT NULL AND "newCloseAt" > "oldCloseAt")'),
]


def upgrade() -> None:
    for table, name, condition in CONSTRAINTS:
        op.create_check_constraint(name, table, condition)


def downgrade() -> None:
    for table, name, _ in reversed(CONSTRAINTS):
        op.drop_constraint(name, table, type_='check')
