import { renderToBuffer } from "@react-pdf/renderer";

import {
  DataAccessError,
  getBusinessSettings,
  getCurrentProfile,
  getPaymentAccounts,
} from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { AgreementDocument } from "@/lib/pdf/agreement";
import { documentFilename } from "@/lib/quotations/numbering";
import { createClient } from "@/lib/supabase/server";

/**
 * The downloadable rental agreement (Spec 4.5).
 *
 * Like the quotation PDF, this is its own authorization boundary:
 * `proxy.ts` only refreshes sessions and no page guard has run.
 */

// fontkit reads the bundled font from disk, so this cannot run on Edge.
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Next 16: route params are async.
  const { id } = await params;

  const profile = await getCurrentProfile();
  if (!profile) {
    return new Response("Sign in to download this agreement.", { status: 401 });
  }
  if (!can(profile, "bookings.view")) {
    return new Response("You do not have access to bookings.", { status: 403 });
  }

  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select("*, customers(*), rental_agreements(*)")
    .eq("id", id)
    .single();

  if (!booking) {
    return new Response("That booking no longer exists.", { status: 404 });
  }

  // Supabase returns a one-to-one embed as an object, but an array
  // when it cannot prove uniqueness — normalise before using it.
  const agreement = Array.isArray(booking.rental_agreements)
    ? booking.rental_agreements[0]
    : booking.rental_agreements;

  if (!agreement) {
    return new Response(
      "No agreement has been generated for this booking yet.",
      { status: 409 },
    );
  }

  // Same reasoning as the quotation route: an agreement missing its
  // payment details is not a document worth signing.
  let items, business, paymentAccounts;
  try {
    [{ data: items }, business, paymentAccounts] = await Promise.all([
      supabase
        .from("booking_items")
        .select("*, catalog_items(replacement_value_centavos)")
        .eq("booking_id", id)
        .order("sort_order", { ascending: true }),
      getBusinessSettings(),
      getPaymentAccounts(),
    ]);
  } catch (error) {
    if (error instanceof DataAccessError) {
      return new Response(
        `${error.message}. The agreement was not generated — fix this before sending anything to a customer.`,
        { status: 503 },
      );
    }
    throw error;
  }

  const customer = booking.customers;
  if (!customer) {
    return new Response("The customer for this booking is missing.", {
      status: 409,
    });
  }
  if (!business) {
    return new Response(
      "Business details are not set up yet — fill them in under Settings first.",
      { status: 409 },
    );
  }

  const buffer = await renderToBuffer(
    AgreementDocument({
      agreement,
      booking,
      items: (items ?? []).map((item) => ({
        ...item,
        replacement_value_centavos:
          item.catalog_items?.replacement_value_centavos ?? 0,
      })),
      customer,
      business,
      paymentAccounts,
    }),
  );

  const filename = documentFilename(agreement.agreement_number);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
