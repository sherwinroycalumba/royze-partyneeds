/**
 * Database types for the Royze Party Needs schema.
 *
 * Kept in sync by hand with `supabase/migrations/*.sql`. Once the
 * Supabase CLI is linked you can regenerate this file with:
 *   npx supabase gen types typescript --linked > lib/supabase/database.types.ts
 */

export type UserRole =
  | "owner"
  | "booking_staff"
  | "delivery_staff"
  | "bookkeeper";

/** One entry of the per-area suggested delivery fee table (Spec 4.12). */
export type DeliveryFeeArea = {
  area: string;
  /** Integer centavos — never a float. */
  fee_centavos: number;
};

/** One editable clause block of the rental agreement (Spec 4.5). */
export type AgreementClause = {
  heading: string;
  body: string;
};

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  catalog_manager: boolean;
  is_active: boolean;
  must_change_password: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Where customers may send money (Spec 4.12). */
export type PaymentChannel = "gcash" | "maya" | "bank_transfer";

export type PaymentAccount = {
  id: string;
  channel: PaymentChannel;
  /** Only meaningful for bank transfers. */
  bank_name: string;
  account_name: string;
  account_number: string;
  /** Inactive accounts stay on file but are left off documents. */
  is_active: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type BusinessSettings = {
  id: boolean;
  business_name: string;
  address: string;
  contact_numbers: string[];
  email: string | null;
  facebook_page: string | null;
  tin: string | null;
  logo_url: string | null;
  downpayment_percent: number;
  quotation_validity_days: number;
  free_delivery_area: string;
  delivery_fee_table: DeliveryFeeArea[];
  agreement_clauses: AgreementClause[];
  expense_categories: string[];
  updated_by: string | null;
  updated_at: string;
};

/** Grouping for a backdrop package's bill of components (Spec 4.2). */
export type ComponentKind =
  | "structure"
  | "cloth"
  | "lights"
  | "consumable"
  | "other";

export type CatalogItem = {
  id: string;
  name: string;
  category: string;
  description: string;
  photo_url: string | null;
  is_rental: boolean;
  is_sale: boolean;
  /** Per event/day. Integer centavos. */
  rental_price_centavos: number;
  replacement_value_centavos: number;
  quantity_owned: number;
  sale_price_centavos: number;
  /** Owner/bookkeeper only — omitted from the select list for others. */
  cost_price_centavos: number;
  stock_quantity: number;
  low_stock_threshold: number;
  /** Out of service until the Owner repairs or writes it off (Spec 4.4). */
  damaged_quantity: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type BackdropPackage = {
  id: string;
  name: string;
  description: string;
  photo_url: string | null;
  occasion_tags: string[];
  package_price_centavos: number;
  setup_minutes: number;
  teardown_notes: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type BackdropPackageComponent = {
  id: string;
  package_id: string;
  catalog_item_id: string;
  quantity: number;
  kind: ComponentKind;
  /** Consumables decrement sale stock; the rest are reserved. */
  consumes_stock: boolean;
  sort_order: number;
};

export type PriceHistoryEntry = {
  id: number;
  entity_type: "catalog_item" | "backdrop_package";
  entity_id: string;
  entity_name: string;
  field: string;
  old_value_centavos: number;
  new_value_centavos: number;
  changed_by: string | null;
  changed_by_name: string;
  changed_at: string;
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  alt_phone: string | null;
  facebook_name: string | null;
  facebook_url: string | null;
  address: string;
  landmark: string | null;
  email: string | null;
  notes: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Generated in the database — digits only, for duplicate detection. */
  phone_digits: string;
};

export type Supplier = {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string;
  email: string | null;
  address: string;
  supplies: string;
  notes: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Spec 4.3: Draft → Sent → Accepted, or Declined / Expired. */
export type QuotationStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "declined"
  | "expired";

/**
 * What a quotation line is selling. `custom` is a one-off typed by
 * staff that points at no catalog record.
 */
export type QuotationLineType = "rental" | "sale" | "package" | "custom";

export type Quotation = {
  id: string;
  quotation_number: string;
  customer_id: string;
  status: QuotationStatus;
  /** `YYYY-MM-DD` in Manila — a calendar day, not an instant. */
  issue_date: string;
  valid_until: string;
  event_date: string | null;
  event_address: string;
  occasion: string;
  /** Inside the free area the fee is forced to ₱0 (Spec 4.4). */
  within_free_delivery_area: boolean;
  delivery_fee_centavos: number;
  delivery_fee_override_reason: string;
  discount_centavos: number;
  /** Snapshotted at creation so a later settings change cannot
   *  restate a document the customer already holds. */
  downpayment_percent: number;
  notes: string;
  /** Never printed on the customer's copy. */
  internal_notes: string;
  sent_at: string | null;
  decided_at: string | null;
  converted_booking_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Names and prices are frozen onto the line at quoting time — a later
 * catalog price edit must never restate a sent quotation.
 */
export type QuotationItem = {
  id: string;
  quotation_id: string;
  line_type: QuotationLineType;
  catalog_item_id: string | null;
  package_id: string | null;
  description: string;
  component_summary: string;
  quantity: number;
  unit_price_centavos: number;
  line_discount_centavos: number;
  sort_order: number;
};

/** The booking lifecycle (Spec 4.4). */
export type BookingStatus =
  | "inquiry"
  | "quoted"
  | "reserved"
  | "confirmed"
  | "out_for_delivery"
  | "delivered"
  | "picked_up"
  | "completed"
  | "cancelled";

export type BookingLineType =
  | "rental"
  | "sale"
  | "package"
  | "custom"
  /** Raised automatically when an item comes back damaged or lost. */
  | "damage_charge";

export type ReturnCondition = "pending" | "ok" | "damaged" | "lost";

export type Booking = {
  id: string;
  booking_number: string;
  customer_id: string;
  status: BookingStatus;
  /** Set when this booking was converted from a quotation. */
  source_quotation_id: string | null;

  event_date: string;
  event_start_time: string | null;
  event_end_time: string | null;
  delivery_at: string | null;
  pickup_at: string | null;
  setup_at: string | null;
  teardown_at: string | null;

  /** The window stock is held for — written from `reservationWindow`. */
  reserved_from: string;
  reserved_to: string;

  event_address: string;
  landmark: string;
  contact_person_name: string;
  contact_person_phone: string;

  occasion: string;
  theme_motif: string;
  celebrant_name: string;
  reference_photo_urls: string[];

  within_free_delivery_area: boolean;
  delivery_fee_centavos: number;
  delivery_fee_override_reason: string;
  discount_centavos: number;
  downpayment_percent: number;

  /** Written by the agreement workflow in Milestone 5. */
  agreement_signed: boolean;
  agreement_signed_at: string | null;
  confirmation_override_reason: string;
  availability_override_reason: string;

  assigned_delivery_staff: string | null;

  notes: string;
  internal_notes: string;

  reserved_at: string | null;
  confirmed_at: string | null;
  delivered_at: string | null;
  returned_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string;

  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type BookingItem = {
  id: string;
  booking_id: string;
  line_type: BookingLineType;
  catalog_item_id: string | null;
  package_id: string | null;
  /** Set on the component rows that expand under a package line. */
  parent_item_id: string | null;
  is_component: boolean;

  description: string;
  component_summary: string;

  quantity: number;
  unit_price_centavos: number;
  line_discount_centavos: number;

  /** Rental stock held for the booking's window. */
  reserves_stock: boolean;
  /** Consumables come out of sale stock when the booking is confirmed. */
  consumes_stock: boolean;
  stock_consumed: boolean;

  return_condition: ReturnCondition;
  return_notes: string;
  damaged_quantity: number;
  lost_quantity: number;
  source_item_id: string | null;

  sort_order: number;
};

export type AuditLogEntry = {
  id: number;
  actor_id: string | null;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  details: Json;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & Pick<Profile, "id" | "email">;
        Update: Partial<Profile>;
        Relationships: [];
      };
      business_settings: {
        Row: BusinessSettings;
        Insert: Partial<BusinessSettings>;
        Update: Partial<BusinessSettings>;
        Relationships: [];
      };
      audit_log: {
        Row: AuditLogEntry;
        Insert: Omit<AuditLogEntry, "id" | "created_at"> &
          Partial<Pick<AuditLogEntry, "created_at">>;
        // The table is append-only in the database (no UPDATE policy);
        // the type is present only because postgrest-js requires it.
        Update: Partial<AuditLogEntry>;
        Relationships: [];
      };
      catalog_items: {
        Row: CatalogItem;
        Insert: Partial<CatalogItem> & Pick<CatalogItem, "name">;
        Update: Partial<CatalogItem>;
        Relationships: [];
      };
      backdrop_packages: {
        Row: BackdropPackage;
        Insert: Partial<BackdropPackage> & Pick<BackdropPackage, "name">;
        Update: Partial<BackdropPackage>;
        Relationships: [];
      };
      backdrop_package_components: {
        Row: BackdropPackageComponent;
        Insert: Partial<BackdropPackageComponent> &
          Pick<BackdropPackageComponent, "package_id" | "catalog_item_id">;
        Update: Partial<BackdropPackageComponent>;
        // Declared so postgrest-js can type the embedded selects that
        // resolve a package's components to their catalog items.
        Relationships: [
          {
            foreignKeyName: "backdrop_package_components_package_id_fkey";
            columns: ["package_id"];
            isOneToOne: false;
            referencedRelation: "backdrop_packages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "backdrop_package_components_catalog_item_id_fkey";
            columns: ["catalog_item_id"];
            isOneToOne: false;
            referencedRelation: "catalog_items";
            referencedColumns: ["id"];
          },
        ];
      };
      price_history: {
        Row: PriceHistoryEntry;
        Insert: Omit<PriceHistoryEntry, "id" | "changed_at"> &
          Partial<Pick<PriceHistoryEntry, "changed_at">>;
        // Append-only in the database; typed only for postgrest-js.
        Update: Partial<PriceHistoryEntry>;
        Relationships: [];
      };
      customers: {
        Row: Customer;
        // phone_digits is generated in the database — never written.
        Insert: Partial<Omit<Customer, "phone_digits">> &
          Pick<Customer, "name">;
        Update: Partial<Omit<Customer, "phone_digits">>;
        Relationships: [];
      };
      suppliers: {
        Row: Supplier;
        Insert: Partial<Supplier> & Pick<Supplier, "name">;
        Update: Partial<Supplier>;
        Relationships: [];
      };
      payment_accounts: {
        Row: PaymentAccount;
        Insert: Partial<PaymentAccount> &
          Pick<PaymentAccount, "channel" | "account_number">;
        Update: Partial<PaymentAccount>;
        Relationships: [];
      };
      quotations: {
        Row: Quotation;
        Insert: Partial<Quotation> &
          Pick<Quotation, "quotation_number" | "customer_id" | "valid_until">;
        Update: Partial<Quotation>;
        Relationships: [
          {
            foreignKeyName: "quotations_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      bookings: {
        Row: Booking;
        Insert: Partial<Booking> &
          Pick<
            Booking,
            | "booking_number"
            | "customer_id"
            | "event_date"
            | "reserved_from"
            | "reserved_to"
          >;
        Update: Partial<Booking>;
        Relationships: [
          {
            foreignKeyName: "bookings_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_source_quotation_id_fkey";
            columns: ["source_quotation_id"];
            isOneToOne: false;
            referencedRelation: "quotations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_assigned_delivery_staff_fkey";
            columns: ["assigned_delivery_staff"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_items: {
        Row: BookingItem;
        Insert: Partial<BookingItem> &
          Pick<BookingItem, "booking_id" | "description">;
        Update: Partial<BookingItem>;
        Relationships: [
          {
            foreignKeyName: "booking_items_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_items_catalog_item_id_fkey";
            columns: ["catalog_item_id"];
            isOneToOne: false;
            referencedRelation: "catalog_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_items_package_id_fkey";
            columns: ["package_id"];
            isOneToOne: false;
            referencedRelation: "backdrop_packages";
            referencedColumns: ["id"];
          },
        ];
      };
      quotation_items: {
        Row: QuotationItem;
        Insert: Partial<QuotationItem> &
          Pick<QuotationItem, "quotation_id" | "description">;
        Update: Partial<QuotationItem>;
        Relationships: [
          {
            foreignKeyName: "quotation_items_quotation_id_fkey";
            columns: ["quotation_id"];
            isOneToOne: false;
            referencedRelation: "quotations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotation_items_catalog_item_id_fkey";
            columns: ["catalog_item_id"];
            isOneToOne: false;
            referencedRelation: "catalog_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quotation_items_package_id_fkey";
            columns: ["package_id"];
            isOneToOne: false;
            referencedRelation: "backdrop_packages";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      auth_role: { Args: Record<string, never>; Returns: UserRole };
      is_owner: { Args: Record<string, never>; Returns: boolean };
      is_active_user: { Args: Record<string, never>; Returns: boolean };
      can_manage_catalog: { Args: Record<string, never>; Returns: boolean };
      can_manage_quotations: { Args: Record<string, never>; Returns: boolean };
      can_view_quotations: { Args: Record<string, never>; Returns: boolean };
      can_manage_bookings: { Args: Record<string, never>; Returns: boolean };
      can_touch_bookings: { Args: Record<string, never>; Returns: boolean };
      booking_holds_stock: {
        Args: { p_status: BookingStatus };
        Returns: boolean;
      };
      /** Rental stock already spoken for across an overlapping window. */
      reserved_quantities: {
        Args: { p_from: string; p_to: string; p_exclude?: string | null };
        Returns: { catalog_item_id: string; reserved_quantity: number }[];
      };
      /** Reserves the next PREFIX-YYYY-#### under a row lock. */
      next_document_number: {
        Args: { p_prefix: string; p_year?: number };
        Returns: string;
      };
      complete_password_change: {
        Args: Record<string, never>;
        Returns: void;
      };
    };
    Enums: {
      user_role: UserRole;
      component_kind: ComponentKind;
      payment_channel: PaymentChannel;
      quotation_status: QuotationStatus;
      quotation_line_type: QuotationLineType;
      booking_status: BookingStatus;
      booking_line_type: BookingLineType;
      return_condition: ReturnCondition;
    };
    CompositeTypes: Record<string, never>;
  };
};
