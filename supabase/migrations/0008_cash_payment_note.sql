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
    default 'At the shop.';

-- A column default only reaches rows created after it, so an install
-- that already ran an earlier version of this file keeps the wording it
-- was created with. Set it explicitly, guarded on the old text so a
-- re-run cannot overwrite whatever the owner has since typed in
-- Settings → Payment Channels.
update public.business_settings
   set cash_payment_note = 'At the shop.'
 where id
   and cash_payment_note = 'On delivery or at the shop.';
