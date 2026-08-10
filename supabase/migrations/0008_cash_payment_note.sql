-- ═══════════════════════════════════════════════════════════════
-- Royze Party Needs Rental — editable cash instructions
--
-- "How to pay" on quotations and rental agreements listed a CASH box
-- with hard-coded wording, which meant a business that does not take
-- cash on delivery had no way to say so. Every other line of
-- customer-facing text is owner-editable (Spec 4.5, 4.12); this one
-- should be too.
--
-- Blank means the business takes no cash at all, and the box is left
-- off the documents entirely.
-- ═══════════════════════════════════════════════════════════════

alter table public.business_settings
  add column if not exists cash_payment_note text not null
    default 'On delivery or at the shop.';
