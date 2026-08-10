import { redirect } from "next/navigation";

/** User management moved under Settings; keep old links working. */
export default function LegacyUsersPage() {
  redirect("/settings/users");
}
