import { renderToBuffer } from "@react-pdf/renderer";

import {
  DataAccessError,
  getBusinessSettings,
  getCurrentProfile,
} from "@/lib/auth/dal";
import { can } from "@/lib/auth/permissions";
import { todayInManila } from "@/lib/date";
import { isCalendarDate } from "@/lib/documents/totals";
import { ReportDocument } from "@/lib/pdf/report";
import { buildReport } from "@/lib/reports/build";
import { reportFilename, reportToCsv } from "@/lib/reports/csv";
import { isReportKind } from "@/lib/reports/types";

/**
 * Report downloads (Spec 4.11): "all exportable to CSV and PDF".
 *
 * Its own authorization boundary, like the other document routes —
 * `proxy.ts` only refreshes sessions and no page guard has run here.
 */

// fontkit reads the bundled font from disk for the PDF branch.
export const runtime = "nodejs";

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return new Response("Sign in to export a report.", { status: 401 });
  }
  if (!can(profile, "reports.export")) {
    return new Response("You do not have access to report exports.", {
      status: 403,
    });
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "";
  const format = url.searchParams.get("format") ?? "csv";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";

  if (!isReportKind(kind)) {
    return new Response("Unknown report.", { status: 400 });
  }
  if (!isCalendarDate(from) || !isCalendarDate(to)) {
    return new Response("Give a from and to date, as calendar dates.", {
      status: 400,
    });
  }
  if (to < from) {
    return new Response("The end of the range is before its start.", {
      status: 400,
    });
  }

  let report;
  let business;
  try {
    [report, business] = await Promise.all([
      buildReport(kind, { from, to }),
      getBusinessSettings(),
    ]);
  } catch (error) {
    if (error instanceof DataAccessError) {
      return new Response(`${error.message}. The report was not generated.`, {
        status: 503,
      });
    }
    throw error;
  }

  if (format === "csv") {
    const filename = reportFilename(report, "csv");
    return new Response(reportToCsv(report), {
      headers: {
        // The charset matters: the peso sign and en-dashes in the
        // aging buckets are not ASCII.
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (format !== "pdf") {
    return new Response("Export format must be csv or pdf.", { status: 400 });
  }

  if (!business) {
    return new Response(
      "Business details are not set up yet — fill them in under Settings first.",
      { status: 409 },
    );
  }

  const buffer = await renderToBuffer(
    ReportDocument({
      report,
      business,
      generatedOn: todayInManila(),
      generatedBy: profile.full_name || profile.email,
    }),
  );

  const filename = reportFilename(report, "pdf");

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
