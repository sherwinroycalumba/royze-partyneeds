/**
 * Seed script (Spec 5).
 *
 *   npm run seed
 *
 * Creates the Owner account, the known price catalog, and the backdrop
 * packages, so the app is usable on first run. With
 * SEED_DEMO_USERS=true it also adds one account per role, sample
 * customers and suppliers, and a week of demo operations — a
 * quotation, a booking with payments, a quick sale, and expenses — so
 * the dashboard, calendar, and reports show something real instead of
 * eight empty tables.
 *
 * Safe to re-run: anything already present is reported and left alone,
 * so a re-run never overwrites prices the owner has since adjusted,
 * nor duplicates the demo data.
 */

import { createClient } from "@supabase/supabase-js";

import type {
  ComponentKind,
  Database,
  UserRole,
} from "../lib/supabase/database.types";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`✗ Missing ${name}. Copy .env.example to .env.local first.`);
    process.exit(1);
  }
  return value;
}

const supabase = createClient<Database>(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

type SeedUser = {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
  catalogManager?: boolean;
};

async function seedUser(user: SeedUser): Promise<void> {
  const { data, error } = await supabase.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: {
      full_name: user.fullName,
      role: user.role,
      catalog_manager: user.catalogManager ?? false,
      must_change_password: true,
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes("already")) {
      console.log(`  • ${user.email} — already exists, skipped`);
      return;
    }
    throw new Error(`${user.email}: ${error.message}`);
  }

  // The on-insert trigger already created the profile; make sure the
  // role and flag landed even if metadata parsing fell back.
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      full_name: user.fullName,
      role: user.role,
      catalog_manager: user.catalogManager ?? false,
    })
    .eq("id", data.user!.id);

  if (profileError) {
    throw new Error(`${user.email} profile: ${profileError.message}`);
  }

  console.log(`  ✓ ${user.email} — ${user.role}`);
}

async function ensureSettings(): Promise<void> {
  const { data } = await supabase
    .from("business_settings")
    .select("id")
    .eq("id", true)
    .maybeSingle();

  if (data) {
    console.log("  • business settings already present, skipped");
    return;
  }

  const { error } = await supabase.from("business_settings").insert({ id: true });

  if (error) {
    throw new Error(`business settings: ${error.message}`);
  }

  console.log("  ✓ business settings created");
}

// ── Catalog (Spec 5) ──────────────────────────────────────────
// Prices are ₱ in integer centavos and are starting points only — the
// owner adjusts them in the app, and a re-run never overwrites them.
const peso = (amount: number): number => Math.round(amount * 100);

type SeedItem = {
  name: string;
  category: string;
  description?: string;
  rental?: { price: number; replacement: number; owned: number };
  sale?: { price: number; cost?: number; stock: number; lowStock: number };
};

const CATALOG: SeedItem[] = [
  // Tents
  {
    name: "Tent 2x2m",
    category: "Tents",
    rental: { price: 800, replacement: 6000, owned: 4 },
  },
  {
    name: "Tent 3x3m",
    category: "Tents",
    rental: { price: 1200, replacement: 9000, owned: 4 },
  },
  {
    name: "Tent 3x6m",
    category: "Tents",
    rental: { price: 2000, replacement: 15000, owned: 2 },
  },

  // Furniture
  {
    name: "Monoblock Chair",
    category: "Tables & Chairs",
    rental: { price: 15, replacement: 450, owned: 200 },
  },
  {
    name: "Rectangular Table (6-seater)",
    category: "Tables & Chairs",
    rental: { price: 150, replacement: 2500, owned: 20 },
  },
  {
    name: "Round Table (8-seater)",
    category: "Tables & Chairs",
    rental: { price: 200, replacement: 3000, owned: 10 },
  },

  // Covers — rented out and also sold, the case Spec 4.2 calls out.
  {
    name: "Table Cover",
    category: "Covers & Linens",
    rental: { price: 50, replacement: 600, owned: 40 },
    sale: { price: 350, cost: 200, stock: 20, lowStock: 5 },
  },
  {
    name: "Chair Cover",
    category: "Covers & Linens",
    rental: { price: 20, replacement: 250, owned: 200 },
    sale: { price: 150, cost: 90, stock: 40, lowStock: 10 },
  },

  // Sound
  {
    name: "Karaoke Machine",
    category: "Sound & Karaoke",
    description: "With two microphones and song book.",
    rental: { price: 1500, replacement: 18000, owned: 2 },
  },

  // Backdrop structures
  {
    name: "Arch Backdrop Frame",
    category: "Backdrop Structures",
    rental: { price: 1000, replacement: 8000, owned: 3 },
  },
  {
    name: "Rectangular Backdrop Frame",
    category: "Backdrop Structures",
    rental: { price: 900, replacement: 7000, owned: 2 },
  },
  {
    name: "Metal Bar Backdrop Stand",
    category: "Backdrop Structures",
    rental: { price: 700, replacement: 5000, owned: 3 },
  },

  // Draping
  {
    name: "White Cloth Draping Set",
    category: "Covers & Linens",
    rental: { price: 500, replacement: 3500, owned: 4 },
  },
  {
    name: "Coloured Cloth Draping Set",
    category: "Covers & Linens",
    rental: { price: 550, replacement: 3500, owned: 4 },
  },

  // Lights
  {
    name: "Fairy Lights (10m)",
    category: "Lights",
    rental: { price: 250, replacement: 900, owned: 10 },
  },
  {
    name: "Butterfly Lights",
    category: "Lights",
    rental: { price: 300, replacement: 1200, owned: 6 },
  },

  // Sale items (Spec 5 asks for roughly fifteen)
  {
    name: "Latex Balloons (pack of 100)",
    category: "Balloons",
    sale: { price: 250, cost: 150, stock: 30, lowStock: 8 },
  },
  {
    name: "Confetti Balloons (pack of 12)",
    category: "Balloons",
    sale: { price: 200, cost: 120, stock: 20, lowStock: 5 },
  },
  {
    name: "Foil Balloon — Number",
    category: "Balloons",
    sale: { price: 120, cost: 65, stock: 40, lowStock: 10 },
  },
  {
    name: "Foil Balloon — Letter",
    category: "Balloons",
    sale: { price: 110, cost: 60, stock: 40, lowStock: 10 },
  },
  {
    name: "Party Poppers",
    category: "Party Supplies",
    sale: { price: 35, cost: 18, stock: 100, lowStock: 20 },
  },
  {
    name: "Gender Reveal Smoke Stick",
    category: "Party Supplies",
    sale: { price: 350, cost: 200, stock: 12, lowStock: 4 },
  },
  {
    name: "Gender Reveal Popper",
    category: "Party Supplies",
    sale: { price: 250, cost: 140, stock: 12, lowStock: 4 },
  },
  {
    name: "Paper Cups (pack of 50)",
    category: "Tableware",
    sale: { price: 90, cost: 55, stock: 40, lowStock: 10 },
  },
  {
    name: "Paper Plates (pack of 50)",
    category: "Tableware",
    sale: { price: 120, cost: 75, stock: 40, lowStock: 10 },
  },
  {
    name: "Spoon & Fork Set (pack of 50)",
    category: "Tableware",
    sale: { price: 100, cost: 60, stock: 30, lowStock: 8 },
  },
  {
    name: "Party Hats (pack of 12)",
    category: "Party Supplies",
    sale: { price: 80, cost: 45, stock: 30, lowStock: 8 },
  },
  {
    name: "Blowouts (pack of 12)",
    category: "Party Supplies",
    sale: { price: 75, cost: 40, stock: 30, lowStock: 8 },
  },
  {
    name: "Happy Birthday Banner",
    category: "Party Supplies",
    sale: { price: 150, cost: 85, stock: 25, lowStock: 6 },
  },
  {
    name: "Balloon Tape Strip",
    category: "Balloons",
    sale: { price: 60, cost: 30, stock: 50, lowStock: 12 },
  },
  {
    name: "Balloon Glue Dots (roll)",
    category: "Balloons",
    sale: { price: 55, cost: 28, stock: 50, lowStock: 12 },
  },
  {
    name: "Assorted Toy Giveaways",
    category: "Toys & Giveaways",
    sale: { price: 45, cost: 25, stock: 80, lowStock: 20 },
  },
];

type SeedComponent = {
  item: string;
  quantity: number;
  kind: ComponentKind;
  consumes: boolean;
};

type SeedPackage = {
  name: string;
  description: string;
  occasions: string[];
  price: number;
  setupMinutes: number;
  teardownNotes: string;
  components: SeedComponent[];
};

const PACKAGES: SeedPackage[] = [
  {
    name: "Birthday Arch Package",
    description:
      "Balloon arch on a curved frame with fairy lights and draped cloth. Includes on-site setup and teardown.",
    occasions: ["birthday"],
    price: 4500,
    setupMinutes: 120,
    teardownNotes: "Pop balloons on site, roll cloth, coil lights.",
    components: [
      { item: "Arch Backdrop Frame", quantity: 1, kind: "structure", consumes: false },
      { item: "Coloured Cloth Draping Set", quantity: 1, kind: "cloth", consumes: false },
      { item: "Fairy Lights (10m)", quantity: 2, kind: "lights", consumes: false },
      { item: "Latex Balloons (pack of 100)", quantity: 2, kind: "consumable", consumes: true },
      { item: "Foil Balloon — Number", quantity: 2, kind: "consumable", consumes: true },
      { item: "Balloon Tape Strip", quantity: 2, kind: "consumable", consumes: true },
    ],
  },
  {
    name: "Wedding Backdrop Package",
    description:
      "White rectangular backdrop with layered draping, butterfly lights, and a soft pastel balloon accent.",
    occasions: ["wedding", "anniversary"],
    price: 6500,
    setupMinutes: 180,
    teardownNotes: "Fold cloth clean and dry — white sets stain easily.",
    components: [
      { item: "Rectangular Backdrop Frame", quantity: 1, kind: "structure", consumes: false },
      { item: "White Cloth Draping Set", quantity: 2, kind: "cloth", consumes: false },
      { item: "Butterfly Lights", quantity: 2, kind: "lights", consumes: false },
      { item: "Fairy Lights (10m)", quantity: 2, kind: "lights", consumes: false },
      { item: "Latex Balloons (pack of 100)", quantity: 1, kind: "consumable", consumes: true },
      { item: "Balloon Glue Dots (roll)", quantity: 2, kind: "consumable", consumes: true },
    ],
  },
  {
    name: "Christening Package",
    description:
      "Soft pastel backdrop on metal bars with the child's name in foil letters.",
    occasions: ["christening"],
    price: 3800,
    setupMinutes: 90,
    teardownNotes: "Keep foil letters — they are reusable if undamaged.",
    components: [
      { item: "Metal Bar Backdrop Stand", quantity: 1, kind: "structure", consumes: false },
      { item: "White Cloth Draping Set", quantity: 1, kind: "cloth", consumes: false },
      { item: "Fairy Lights (10m)", quantity: 1, kind: "lights", consumes: false },
      { item: "Latex Balloons (pack of 100)", quantity: 1, kind: "consumable", consumes: true },
      { item: "Foil Balloon — Letter", quantity: 8, kind: "consumable", consumes: true },
    ],
  },
  {
    name: "Gender Reveal Package",
    description:
      "Neutral backdrop with a confetti reveal balloon, smoke sticks, and poppers for the moment itself.",
    occasions: ["gender_reveal"],
    price: 5200,
    setupMinutes: 120,
    teardownNotes: "Collect smoke stick canisters; do not leave on site.",
    components: [
      { item: "Arch Backdrop Frame", quantity: 1, kind: "structure", consumes: false },
      { item: "White Cloth Draping Set", quantity: 1, kind: "cloth", consumes: false },
      { item: "Fairy Lights (10m)", quantity: 2, kind: "lights", consumes: false },
      { item: "Confetti Balloons (pack of 12)", quantity: 1, kind: "consumable", consumes: true },
      { item: "Gender Reveal Smoke Stick", quantity: 2, kind: "consumable", consumes: true },
      { item: "Gender Reveal Popper", quantity: 4, kind: "consumable", consumes: true },
    ],
  },
];

/** Inserts the catalog, skipping items already present by name. */
async function seedCatalog(ownerId: string | null): Promise<void> {
  const { data: existing } = await supabase.from("catalog_items").select("name");
  const present = new Set((existing ?? []).map((item) => item.name));

  const rows = CATALOG.filter((item) => !present.has(item.name)).map((item) => ({
    name: item.name,
    category: item.category,
    description: item.description ?? "",
    is_rental: Boolean(item.rental),
    is_sale: Boolean(item.sale),
    rental_price_centavos: peso(item.rental?.price ?? 0),
    replacement_value_centavos: peso(item.rental?.replacement ?? 0),
    quantity_owned: item.rental?.owned ?? 0,
    sale_price_centavos: peso(item.sale?.price ?? 0),
    cost_price_centavos: peso(item.sale?.cost ?? 0),
    stock_quantity: item.sale?.stock ?? 0,
    low_stock_threshold: item.sale?.lowStock ?? 0,
    created_by: ownerId,
  }));

  if (rows.length === 0) {
    console.log(`  • ${CATALOG.length} catalog items already present, skipped`);
    return;
  }

  const { error } = await supabase.from("catalog_items").insert(rows);
  if (error) throw new Error(`catalog: ${error.message}`);

  console.log(`  ✓ ${rows.length} catalog items added`);
}

/** Inserts the backdrop packages and their bills of components. */
async function seedPackages(ownerId: string | null): Promise<void> {
  const { data: existing } = await supabase
    .from("backdrop_packages")
    .select("name");
  const present = new Set((existing ?? []).map((row) => row.name));

  const { data: items } = await supabase.from("catalog_items").select("id, name");
  const itemIdByName = new Map((items ?? []).map((item) => [item.name, item.id]));

  let added = 0;
  for (const pkg of PACKAGES) {
    if (present.has(pkg.name)) continue;

    const { data, error } = await supabase
      .from("backdrop_packages")
      .insert({
        name: pkg.name,
        description: pkg.description,
        occasion_tags: pkg.occasions,
        package_price_centavos: peso(pkg.price),
        setup_minutes: pkg.setupMinutes,
        teardown_notes: pkg.teardownNotes,
        created_by: ownerId,
      })
      .select("id")
      .single();

    if (error) throw new Error(`package ${pkg.name}: ${error.message}`);

    const components = pkg.components
      .map((component, index) => {
        const catalogItemId = itemIdByName.get(component.item);
        if (!catalogItemId) {
          console.warn(`    ! ${pkg.name}: no catalog item "${component.item}"`);
          return null;
        }
        return {
          package_id: data.id,
          catalog_item_id: catalogItemId,
          quantity: component.quantity,
          kind: component.kind,
          consumes_stock: component.consumes,
          sort_order: index,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const { error: componentError } = await supabase
      .from("backdrop_package_components")
      .insert(components);

    if (componentError) {
      throw new Error(`package ${pkg.name} components: ${componentError.message}`);
    }

    added += 1;
  }

  console.log(
    added > 0
      ? `  ✓ ${added} backdrop packages added`
      : "  • backdrop packages already present, skipped",
  );
}

/** Sample customers and suppliers, so the lists are not empty in a demo. */
async function seedSampleContacts(ownerId: string | null): Promise<void> {
  const customers = [
    {
      name: "Maria Santos",
      phone: "0917 123 4567",
      facebook_name: "Maria Santos",
      address: "Blk 12 Lot 4, Deca Homes Meycauayan, Bulacan",
      landmark: "Beside the covered court",
      notes: "Books a tent and chairs every December.",
    },
    {
      name: "Jose Dela Cruz",
      phone: "0918 555 2211",
      facebook_name: "Joey Dela Cruz",
      address: "Camalig, Meycauayan, Bulacan",
      landmark: "Green gate near the sari-sari store",
      notes: "",
    },
    {
      name: "Ana Reyes",
      phone: "0920 777 8899",
      facebook_name: "Ana Reyes",
      address: "Bancal, Meycauayan, Bulacan",
      landmark: "",
      notes: "Prefers pastel motifs for backdrops.",
    },
  ];

  const suppliers = [
    {
      name: "Divisoria Balloon Supply",
      contact_person: "Aling Nena",
      phone: "0917 400 1122",
      supplies: "Latex balloons, foil balloons, balloon tape, glue dots",
      address: "Divisoria, Manila",
    },
    {
      name: "Bulacan Party Wholesale",
      contact_person: "Mang Boy",
      phone: "0918 220 3344",
      supplies: "Paper cups, plates, spoon & fork sets, party hats",
      address: "Malolos, Bulacan",
    },
    {
      name: "Meycauayan Tent & Steel Works",
      contact_person: "Engr. Cruz",
      phone: "0999 111 2233",
      supplies: "Tent repairs, backdrop frames, metal bar stands",
      address: "Meycauayan, Bulacan",
    },
  ];

  const { data: existingCustomers } = await supabase
    .from("customers")
    .select("name");
  const customersPresent = new Set(
    (existingCustomers ?? []).map((row) => row.name),
  );
  const newCustomers = customers.filter((row) => !customersPresent.has(row.name));

  if (newCustomers.length > 0) {
    const { error } = await supabase
      .from("customers")
      .insert(newCustomers.map((row) => ({ ...row, created_by: ownerId })));
    if (error) throw new Error(`customers: ${error.message}`);
    console.log(`  ✓ ${newCustomers.length} sample customers added`);
  } else {
    console.log("  • sample customers already present, skipped");
  }

  const { data: existingSuppliers } = await supabase
    .from("suppliers")
    .select("name");
  const suppliersPresent = new Set(
    (existingSuppliers ?? []).map((row) => row.name),
  );
  const newSuppliers = suppliers.filter((row) => !suppliersPresent.has(row.name));

  if (newSuppliers.length > 0) {
    const { error } = await supabase
      .from("suppliers")
      .insert(newSuppliers.map((row) => ({ ...row, created_by: ownerId })));
    if (error) throw new Error(`suppliers: ${error.message}`);
    console.log(`  ✓ ${newSuppliers.length} sample suppliers added`);
  } else {
    console.log("  • sample suppliers already present, skipped");
  }
}

// ── Demo operating data (Spec 5) ──────────────────────────────
/**
 * A quotation, two bookings, payments, a quick sale, and a few
 * expenses — enough that the dashboard, the calendar, and all eight
 * reports show something real on first run rather than eight empty
 * tables that teach the owner nothing.
 *
 * Dated relative to today so the demo never goes stale, and guarded on
 * the document counter so a re-run adds nothing.
 */

/** `YYYY-MM-DD`, `days` from today, in Manila. */
function dayOffset(days: number): string {
  const now = new Date();
  const manila = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Manila" }),
  );
  manila.setDate(manila.getDate() + days);
  return manila.toISOString().slice(0, 10);
}

/** Manila wall-clock time on an offset day, as an ISO instant. */
function instantOffset(days: number, hour: number): string {
  return new Date(`${dayOffset(days)}T${String(hour).padStart(2, "0")}:00:00+08:00`).toISOString();
}

async function nextNumber(prefix: string): Promise<string> {
  const { data, error } = await supabase.rpc("next_document_number", {
    p_prefix: prefix,
  });
  if (error || !data) throw new Error(`numbering: ${error?.message}`);
  return data;
}

async function seedDemoOperations(ownerId: string | null): Promise<void> {
  // One booking is enough to tell whether this has run before.
  const { count } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true });

  if ((count ?? 0) > 0) {
    console.log("  • demo bookings already present, skipped");
    return;
  }

  const { data: customers } = await supabase
    .from("customers")
    .select("id, name")
    .order("name");
  const { data: items } = await supabase
    .from("catalog_items")
    .select("id, name, is_rental, is_sale, rental_price_centavos, sale_price_centavos")
    .eq("is_active", true);
  const { data: packages } = await supabase
    .from("backdrop_packages")
    .select("id, name, package_price_centavos")
    .eq("is_active", true);

  if (!customers?.length || !items?.length) {
    console.log("  • no customers or catalog yet, skipped");
    return;
  }

  const customer = customers[0];
  const secondCustomer = customers[1] ?? customers[0];
  const rental = items.find((item) => item.is_rental);
  const saleItem = items.find((item) => item.is_sale);
  const backdrop = packages?.[0];

  if (!rental || !saleItem) {
    console.log("  • catalog has no rental or sale item, skipped");
    return;
  }

  // ── A quotation that has been sent ──────────────────────────
  const quotationNumber = await nextNumber("QT");
  const { data: quotation, error: quotationError } = await supabase
    .from("quotations")
    .insert({
      quotation_number: quotationNumber,
      customer_id: secondCustomer.id,
      status: "sent",
      issue_date: dayOffset(-3),
      valid_until: dayOffset(4),
      event_date: dayOffset(21),
      event_address: "Bancal, Meycauayan, Bulacan",
      occasion: "Christening",
      within_free_delivery_area: true,
      downpayment_percent: 50,
      notes: "Setup by 7:00 AM on the day.",
      sent_at: new Date().toISOString(),
      created_by: ownerId,
    })
    .select("id")
    .single();

  if (quotationError) throw new Error(`quotation: ${quotationError.message}`);

  await supabase.from("quotation_items").insert([
    {
      quotation_id: quotation.id,
      line_type: "rental",
      catalog_item_id: rental.id,
      description: rental.name,
      quantity: 50,
      unit_price_centavos: rental.rental_price_centavos,
      sort_order: 0,
    },
  ]);

  // ── A booking happening this week, half paid ────────────────
  const bookingNumber = await nextNumber("BK");
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .insert({
      booking_number: bookingNumber,
      customer_id: customer.id,
      status: "confirmed",
      event_date: dayOffset(3),
      delivery_at: instantOffset(3, 8),
      pickup_at: instantOffset(4, 9),
      setup_at: backdrop ? instantOffset(3, 7) : null,
      reserved_from: dayOffset(3),
      reserved_to: dayOffset(4),
      event_address: customer.name
        ? "Blk 12 Lot 4, Deca Homes Meycauayan, Bulacan"
        : "",
      landmark: "Beside the covered court",
      contact_person_name: "Ate Let",
      contact_person_phone: "0918 222 3333",
      occasion: "7th Birthday",
      theme_motif: backdrop ? "Safari, sage green and cream" : "",
      celebrant_name: backdrop ? "Sofia" : "",
      within_free_delivery_area: true,
      downpayment_percent: 50,
      agreement_signed: true,
      agreement_signed_at: new Date().toISOString(),
      confirmed_at: new Date().toISOString(),
      reserved_at: new Date().toISOString(),
      notes: "Keep the driveway clear for the delivery tricycle.",
      created_by: ownerId,
    })
    .select("id")
    .single();

  if (bookingError) throw new Error(`booking: ${bookingError.message}`);

  const { data: bookingLines } = await supabase
    .from("booking_items")
    .insert(
      [
        {
          booking_id: booking.id,
          line_type: "rental" as const,
          catalog_item_id: rental.id,
          description: rental.name,
          quantity: 100,
          unit_price_centavos: rental.rental_price_centavos,
          reserves_stock: true,
          sort_order: 0,
        },
        ...(backdrop
          ? [
              {
                booking_id: booking.id,
                line_type: "package" as const,
                package_id: backdrop.id,
                description: backdrop.name,
                quantity: 1,
                unit_price_centavos: backdrop.package_price_centavos,
                sort_order: 1,
              },
            ]
          : []),
      ],
    )
    .select("id, unit_price_centavos, quantity");

  const bookingTotal = (bookingLines ?? []).reduce(
    (sum, line) => sum + line.unit_price_centavos * line.quantity,
    0,
  );

  // Half verified, and a second payment still waiting on the owner —
  // which is what makes the verification queue worth looking at.
  await supabase.from("payments").insert([
    {
      booking_id: booking.id,
      paid_on: dayOffset(-2),
      amount_centavos: Math.round(bookingTotal / 2),
      method: "cash",
      status: "verified",
      verified_by: ownerId,
      verified_at: new Date().toISOString(),
      recorded_by: ownerId,
    },
    {
      booking_id: booking.id,
      paid_on: dayOffset(0),
      amount_centavos: 100_000,
      method: "gcash",
      reference_number: "0012345678",
      status: "pending",
      recorded_by: ownerId,
    },
  ]);

  // ── A quick sale, paid in cash ──────────────────────────────
  const orderNumber = await nextNumber("OR");
  const { data: order } = await supabase
    .from("orders")
    .insert({
      order_number: orderNumber,
      customer_label: "Walk-in",
      status: "completed",
      sold_on: dayOffset(-1),
      sold_by: ownerId,
    })
    .select("id")
    .single();

  if (order) {
    await supabase.from("order_items").insert({
      order_id: order.id,
      catalog_item_id: saleItem.id,
      description: saleItem.name,
      quantity: 3,
      unit_price_centavos: saleItem.sale_price_centavos,
      sort_order: 0,
    });

    await supabase.from("payments").insert({
      order_id: order.id,
      paid_on: dayOffset(-1),
      amount_centavos: saleItem.sale_price_centavos * 3,
      method: "cash",
      status: "verified",
      verified_by: ownerId,
      verified_at: new Date().toISOString(),
      recorded_by: ownerId,
    });
  }

  // ── Expenses, one of them an overdue payable ────────────────
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name")
    .limit(2);

  await supabase.from("expenses").insert([
    {
      expense_date: dayOffset(-5),
      payee: suppliers?.[0]?.name ?? "Divisoria Balloon Supply",
      supplier_id: suppliers?.[0]?.id ?? null,
      category: "Purchases / Restock",
      amount_centavos: 250_000,
      method: "cash",
      is_paid: true,
      paid_on: dayOffset(-5),
      recorded_by: ownerId,
    },
    {
      expense_date: dayOffset(-2),
      payee: "Petron Meycauayan",
      category: "Fuel & Delivery",
      amount_centavos: 60_000,
      method: "cash",
      is_paid: true,
      paid_on: dayOffset(-2),
      recorded_by: ownerId,
    },
    {
      // Deliberately overdue, so the payables queue and the dashboard
      // both have something to show.
      expense_date: dayOffset(-20),
      payee: suppliers?.[1]?.name ?? "Meycauayan Tent & Steel Works",
      supplier_id: suppliers?.[1]?.id ?? null,
      category: "Repairs",
      amount_centavos: 180_000,
      is_paid: false,
      due_date: dayOffset(-6),
      recorded_by: ownerId,
    },
  ]);

  console.log(
    `  ✓ ${quotationNumber}, ${bookingNumber}, ${orderNumber}, and 3 expenses added`,
  );
}

/** The Owner's profile id, stamped as `created_by` on seeded records. */
async function findOwnerId(email: string): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  return data?.id ?? null;
}

async function main(): Promise<void> {
  console.log("\nSeeding Royze Party Needs Rental\n");

  console.log("Business settings");
  await ensureSettings();

  const ownerPassword = required("SEED_OWNER_PASSWORD");
  const ownerEmail = required("SEED_OWNER_EMAIL");

  console.log("\nAccounts");
  await seedUser({
    email: ownerEmail,
    password: ownerPassword,
    fullName: process.env.SEED_OWNER_NAME || "Royze Owner",
    role: "owner",
  });

  if (process.env.SEED_DEMO_USERS === "true") {
    const demoPassword = process.env.SEED_DEMO_PASSWORD || "Demo!2026";

    await seedUser({
      email: "booking@royzepartyneeds.com",
      password: demoPassword,
      fullName: "Bea Booking",
      role: "booking_staff",
      catalogManager: true,
    });
    await seedUser({
      email: "delivery@royzepartyneeds.com",
      password: demoPassword,
      fullName: "Dario Delivery",
      role: "delivery_staff",
    });
    await seedUser({
      email: "books@royzepartyneeds.com",
      password: demoPassword,
      fullName: "Bella Books",
      role: "bookkeeper",
    });
  }

  const ownerId = await findOwnerId(ownerEmail);

  console.log("\nPrice catalog");
  await seedCatalog(ownerId);
  await seedPackages(ownerId);

  if (process.env.SEED_DEMO_USERS === "true") {
    console.log("\nSample contacts");
    await seedSampleContacts(ownerId);

    console.log("\nDemo operations");
    await seedDemoOperations(ownerId);
  }

  console.log(
    "\nDone. Every seeded account must change its password at first sign-in.",
  );
  console.log(
    "Catalog prices are starting points — adjust them under Price Catalog.\n",
  );
}

main().catch((error: unknown) => {
  console.error("\n✗ Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
