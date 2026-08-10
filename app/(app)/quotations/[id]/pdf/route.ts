import { renderToBuffer } from "@react-pdf/renderer";

import {
  DataAccessError,
  getBusinessSettings,
  getCurrentProfile,
  getPaymentAccounts,
} from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { todayInManila } from "@/lib/date";
import { QuotationDocument } from "@/lib/pdf/quotation";
import { documentFilename } from "@/lib/quotations/numbering";
import { createClient } from "@/lib/supabase/server";

/**
 * The downloadable quotation PDF (Spec 4.3).
 *
 * A route handler rather than a page: staff need a real file they can
 * attach in Messenger, which is the whole point of generating one.
 *
 * This is its own authorization boundary. `proxy.ts` only refreshes
 * sessions, and a route handler cannot rely on a page guard having run
 * — so the profile is re-verified and re-checked here, exactly as the
 * DAL does for pages.
 */

// @react-pdf/renderer needs Node APIs (fontkit reads the bundled font
// from disk), so this cannot run on the Edge runtime.
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Next 16: route params are async.
  const { id } = await params;

  const profile = await getCurrentProfile();
  if (!profile) {
    return new Response("Sign in to download this quotation.", { status: 401 });
  }
  if (!can(profile, "quotations.view")) {
    return new Response("You do not have access to quotations.", {
      status: 403,
    });
  }

  const supabase = await createClient();

  // RLS applies on top of the check above — a Delivery Staff session
  // gets nothing back even if this route were reached.
  const { data: quotation } = await supabase
    .from("quotations")
    .select("*")
    .eq("id", id)
    .single();

  if (!quotation) {
    return new Response("That quotation no longer exists.", { status: 404 });
  }

  // A failed read must not fall through as an empty list: a quotation
  // printed without the GCash details is worse than one that refuses.
  let items, customer, business, paymentAccounts;
  try {
    [{ data: items }, { data: customer }, business, paymentAccounts] =
      await Promise.all([
        supabase
          .from("quotation_items")
          .select("*")
          .eq("quotation_id", id)
          .order("sort_order", { ascending: true }),
        supabase
          .from("customers")
          .select("*")
          .eq("id", quotation.customer_id)
          .single(),
        getBusinessSettings(),
        getPaymentAccounts(),
      ]);
  } catch (error) {
    if (error instanceof DataAccessError) {
      return new Response(
        `${error.message}. The quotation was not generated — fix this before sending anything to a customer.`,
        { status: 503 },
      );
    }
    throw error;
  }

  if (!customer) {
    return new Response("The customer for this quotation is missing.", {
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
    QuotationDocument({
      quotation,
      items: items ?? [],
      customer,
      business,
      paymentAccounts,
      today: todayInManila(),
    }),
  );

  // `documentFilename` refuses anything that is not a document number,
  // so nothing from the database can inject a header here.
  const filename = documentFilename(quotation.quotation_number);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.length),
      // A quotation can be edited and re-downloaded; a cached copy of
      // the old figures would be worse than a slightly slower download.
      "Cache-Control": "private, no-store",
    },
  });
}
