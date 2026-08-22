import { redirect } from "next/navigation";

/** Master data is now a tab on `/settings`; kept so existing links still work. */
export default function MasterDataRedirect() {
  redirect("/settings");
}
