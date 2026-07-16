import { appUrl } from "@/lib/app-url";
import type { Locale } from "@/lib/types";

interface ProductSiteNavProps {
  locale: Locale;
  active: "svg" | "ppt";
}

export function ProductSiteNav({ locale, active }: ProductSiteNavProps) {
  return (
    <nav className="site-nav" aria-label="Graptolite Labs navigation">
      <a href="https://graptolite.ai" className="site-nav-logo">
        Graptolite
      </a>
      <ul className="site-nav-links">
        <li className="site-nav-secondary">
          <a href="https://graptolite.ai">Home</a>
        </li>
        <li className="site-nav-secondary">
          <a href="https://labs.graptolite.ai/">Labs</a>
        </li>
        <li className="site-nav-secondary">
          <a href="https://labs.graptolite.ai/timezones/">Time</a>
        </li>
        <li className="site-nav-secondary">
          <a href="https://labs.graptolite.ai/currency/">Currency</a>
        </li>
        <li>
          <a href={appUrl(`/${locale}/svg`)} className={active === "svg" ? "active" : undefined} aria-current={active === "svg" ? "page" : undefined}>
            SVG
          </a>
        </li>
        <li>
          <a href={appUrl(`/${locale}/ppt`)} className={active === "ppt" ? "active" : undefined} aria-current={active === "ppt" ? "page" : undefined}>
            PPT
          </a>
        </li>
      </ul>
    </nav>
  );
}
