import { redirect } from "next/navigation";

import { appUrl } from "@/lib/app-url";

export default function HomePage() {
  redirect(appUrl("/en"));
}
