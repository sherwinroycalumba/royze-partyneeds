import path from "node:path";

import { Font, StyleSheet } from "@react-pdf/renderer";

/**
 * Shared look for every printed document (Spec 2.1, 4.3, 4.5).
 *
 * The quotation is the first user; the rental agreement in Milestone 5
 * and the report exports in Milestone 8 render through the same theme
 * so the whole paper trail looks like one business.
 *
 * Brand orange carries the header band, the table header row, and the
 * total row; body text stays near-black so a grayscale printout — what
 * most staff actually hand over — is still legible (Spec 2.1).
 */

// ── Fonts ──────────────────────────────────────────────────────
/**
 * Inter is bundled rather than relying on the PDF standard fonts,
 * because those cannot render ₱: Helvetica silently substitutes "±"
 * and Times mangles the digits after it, so every amount on the page
 * would be wrong in a way nobody notices until a customer argues.
 * Bundled (not fetched) so PDF generation never depends on a network
 * call at request time. Licence: SIL OFL 1.1, see fonts/LICENSE.
 */
const FONT_DIR = path.join(process.cwd(), "lib", "pdf", "fonts");

export const DOCUMENT_FONT = "Inter";

let fontsRegistered = false;

/** Registers the bundled font once per process. */
export function registerDocumentFonts(): void {
  if (fontsRegistered) return;

  Font.register({
    family: DOCUMENT_FONT,
    fonts: [
      { src: path.join(FONT_DIR, "Inter-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "Inter-Bold.ttf"), fontWeight: 700 },
    ],
  });

  // Long addresses and item names are the only things that wrap oddly;
  // no hyphenation reads better on a quotation than broken words.
  Font.registerHyphenationCallback((word) => [word]);

  fontsRegistered = true;
}

// ── Palette ────────────────────────────────────────────────────
/** Mirrors the `@theme` tokens in app/globals.css. */
export const PDF_COLORS = {
  brand: "#ea580c", // brand-600
  brandDark: "#c2410c", // brand-700
  brandTint: "#fff7ed", // brand-50
  brandBorder: "#fed7aa", // brand-200

  ink: "#1c1917", // ink-900
  inkBody: "#292524", // ink-800
  inkMuted: "#57534e", // ink-600
  inkFaint: "#78716c", // ink-500
  border: "#d6d3d1", // ink-300
  borderLight: "#e7e5e4", // ink-200
  zebra: "#fafaf9", // ink-50
  paper: "#ffffff",

  success: "#15803d", // success-700
} as const;

/** A4 at 72dpi is 595×842pt; 36pt ≈ 12.7mm margins all round. */
export const PAGE_PADDING = 36;

export const documentStyles = StyleSheet.create({
  page: {
    fontFamily: DOCUMENT_FONT,
    fontSize: 9,
    color: PDF_COLORS.inkBody,
    backgroundColor: PDF_COLORS.paper,
    paddingTop: PAGE_PADDING,
    paddingBottom: PAGE_PADDING + 18, // room for the page footer
    paddingHorizontal: PAGE_PADDING,
    // Deliberately NO lineHeight here. A line height on the Page style
    // is inherited by absolutely-positioned `fixed` children and drops
    // them off the page entirely — the running footer silently
    // disappears. Leading is set per text style instead.
  },

  // ── Header band ──────────────────────────────────────────────
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    backgroundColor: PDF_COLORS.brand,
    color: PDF_COLORS.paper,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 4,
  },
  headerBusiness: { flexDirection: "row", alignItems: "center", flexGrow: 1, flexShrink: 1 },
  logo: { width: 42, height: 42, marginRight: 10, objectFit: "contain" },
  logoPlaceholder: {
    width: 42,
    height: 42,
    marginRight: 10,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  logoPlaceholderText: { fontSize: 15, fontWeight: 700, color: PDF_COLORS.paper },
  // The name needs its own leading, or it overlaps the address line.
  businessName: {
    fontSize: 15,
    fontWeight: 700,
    color: PDF_COLORS.paper,
    lineHeight: 1.2,
    marginBottom: 2,
  },
  businessLine: { fontSize: 7.5, lineHeight: 1.45, color: "rgba(255,255,255,0.92)" },

  headerDocument: { alignItems: "flex-end", marginLeft: 12, flexShrink: 0 },
  documentTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: PDF_COLORS.paper,
    letterSpacing: 1.1,
  },
  documentNumber: { fontSize: 10, fontWeight: 700, color: PDF_COLORS.paper, marginTop: 2 },
  documentStatus: {
    marginTop: 4,
    fontSize: 7,
    fontWeight: 700,
    letterSpacing: 0.8,
    color: PDF_COLORS.brandDark,
    backgroundColor: PDF_COLORS.paper,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 8,
  },

  // ── Panels ───────────────────────────────────────────────────
  columns: { flexDirection: "row", gap: 12, marginTop: 14 },
  panel: {
    flexGrow: 1,
    flexBasis: 0,
    borderWidth: 1,
    borderColor: PDF_COLORS.borderLight,
    borderRadius: 4,
    padding: 9,
  },
  panelHeading: {
    fontSize: 7,
    fontWeight: 700,
    letterSpacing: 0.9,
    color: PDF_COLORS.brandDark,
    marginBottom: 4,
  },
  panelStrong: { fontSize: 10, lineHeight: 1.3, fontWeight: 700, color: PDF_COLORS.ink },
  panelLine: { fontSize: 8.5, lineHeight: 1.4, color: PDF_COLORS.inkMuted },

  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 1.5 },
  metaLabel: { fontSize: 8.5, color: PDF_COLORS.inkMuted },
  metaValue: { fontSize: 8.5, fontWeight: 700, color: PDF_COLORS.ink },

  // ── Items table ──────────────────────────────────────────────
  table: { marginTop: 14, borderWidth: 1, borderColor: PDF_COLORS.borderLight, borderRadius: 4 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: PDF_COLORS.brand,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableHeaderCell: {
    fontSize: 7.5,
    fontWeight: 700,
    letterSpacing: 0.6,
    color: PDF_COLORS.paper,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5.5,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: PDF_COLORS.borderLight,
  },
  tableRowAlt: { backgroundColor: PDF_COLORS.zebra },
  cellDescription: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 8 },
  cellQuantity: { width: 42, textAlign: "right" },
  cellUnit: { width: 74, textAlign: "right" },
  cellDiscount: { width: 66, textAlign: "right" },
  cellAmount: { width: 80, textAlign: "right" },
  itemName: { fontSize: 9, lineHeight: 1.35, color: PDF_COLORS.ink },
  itemDetail: { fontSize: 7.5, lineHeight: 1.35, color: PDF_COLORS.inkFaint, marginTop: 1 },
  amount: { fontSize: 9, color: PDF_COLORS.ink },
  amountStrong: { fontSize: 9, fontWeight: 700, color: PDF_COLORS.ink },

  // ── Totals ───────────────────────────────────────────────────
  totalsWrap: { flexDirection: "row", justifyContent: "flex-end", marginTop: 10 },
  totals: { width: 240 },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  totalsLabel: { fontSize: 9, color: PDF_COLORS.inkMuted },
  totalsValue: { fontSize: 9, fontWeight: 700, color: PDF_COLORS.ink },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: PDF_COLORS.brand,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 4,
    marginTop: 4,
  },
  grandTotalLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.5,
    color: PDF_COLORS.paper,
  },
  grandTotalValue: { fontSize: 12, fontWeight: 700, color: PDF_COLORS.paper },
  downpaymentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
    backgroundColor: PDF_COLORS.brandTint,
    borderWidth: 1,
    borderColor: PDF_COLORS.brandBorder,
    borderRadius: 4,
  },
  downpaymentLabel: { fontSize: 8.5, fontWeight: 700, color: PDF_COLORS.brandDark },
  downpaymentValue: { fontSize: 10, fontWeight: 700, color: PDF_COLORS.brandDark },

  // ── Blocks below the table ───────────────────────────────────
  section: { marginTop: 14 },
  sectionHeading: {
    fontSize: 7.5,
    fontWeight: 700,
    letterSpacing: 0.9,
    color: PDF_COLORS.brandDark,
    marginBottom: 4,
  },
  body: { fontSize: 8.5, lineHeight: 1.45, color: PDF_COLORS.inkBody },
  bullet: { flexDirection: "row", marginBottom: 2 },
  bulletMark: { width: 10, fontSize: 8.5, color: PDF_COLORS.brand },
  bulletText: {
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 8.5,
    lineHeight: 1.45,
    color: PDF_COLORS.inkBody,
  },

  channels: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  channel: {
    width: 160,
    borderWidth: 1,
    borderColor: PDF_COLORS.borderLight,
    borderRadius: 4,
    padding: 7,
  },
  channelName: { fontSize: 8, fontWeight: 700, color: PDF_COLORS.brandDark },
  channelLine: { fontSize: 8, lineHeight: 1.4, color: PDF_COLORS.inkBody },
  channelNumber: { fontSize: 9, fontWeight: 700, color: PDF_COLORS.ink },

  // ── Signatures (agreement, Milestone 5) ──────────────────────
  signatures: { flexDirection: "row", gap: 24, marginTop: 24 },
  signature: { flexGrow: 1, flexBasis: 0 },
  signatureLine: {
    borderTopWidth: 1,
    borderTopColor: PDF_COLORS.inkMuted,
    marginTop: 30,
    paddingTop: 3,
  },

  // ── Footer ───────────────────────────────────────────────────
  footer: {
    position: "absolute",
    bottom: 18,
    left: PAGE_PADDING,
    right: PAGE_PADDING,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: PDF_COLORS.borderLight,
    paddingTop: 5,
  },
  footerText: { fontSize: 7, color: PDF_COLORS.inkFaint },
});
