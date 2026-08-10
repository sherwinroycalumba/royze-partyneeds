import { inputClasses } from "@/components/ui/field";
import { buttonClasses } from "@/components/ui/button";

/**
 * Type and status filters as a plain GET form.
 *
 * These change which rows are loaded, so they stay a server round trip
 * and keep the URL shareable. Text search is inline instead — see
 * `CatalogList` — because it only narrows what already came back.
 */
export function CatalogFilters({
  type,
  status,
}: {
  type: string;
  status: string;
}) {
  return (
    <form action="/catalog" className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="catalog-type" className="sr-only">
          Item type
        </label>
        <select
          id="catalog-type"
          name="type"
          defaultValue={type}
          className={inputClasses}
        >
          <option value="all">All types</option>
          <option value="rental">Rental</option>
          <option value="sale">Sale</option>
        </select>
      </div>

      <div>
        <label htmlFor="catalog-status" className="sr-only">
          Status
        </label>
        <select
          id="catalog-status"
          name="status"
          defaultValue={status}
          className={inputClasses}
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <button type="submit" className={buttonClasses("secondary")}>
        Show
      </button>
    </form>
  );
}
