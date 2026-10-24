import { CarIcon, SearchXIcon, WrenchIcon } from "lucide-react";
import { Form, Link, useSubmit } from "react-router";
import { Container, EmptyState, PageHeader } from "~/components/page";
import { ProductGrid } from "~/components/product-card";
import { NativeSelect } from "~/components/ui/input";
import type { ProductKind } from "~/db/schema";
import { getCategories, searchProducts, type SortKey } from "~/lib/catalog.server";
import { cn } from "~/lib/utils";
import { BannerSlot } from "~/components/banner-ads";
import { pageBanners } from "~/lib/banners.server";
import type { ListingType } from "~/db/schema";
import { FEATURE_FLAGS, LISTING_TYPES } from "~/lib/property";
import { AutoFilterFields, autoFiltersFromParams } from "~/components/auto-filters";
import { AUTO_CATEGORY_SLUG } from "~/lib/auto";
import { StickySubmenu, SUBMENU_CHIP } from "~/components/site-header";
import type { Route } from "./+types/search";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
];

/** The first chip of the submenu under each main menu tab. */
const ALL_LABEL: Record<ProductKind, string> = { product: "All products", service: "All services", digital: "All downloads", property: "All real estate" };

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.heading ?? "Browse"} · MyPlug` }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 100) || undefined;
  const category = url.searchParams.get("category") || undefined;
  const sortParam = url.searchParams.get("sort") as SortKey | null;
  const sort = SORTS.some((s) => s.value === sortParam) ? sortParam! : "featured";
  const inStock = url.searchParams.get("instock") === "1";
  const allCategories = await getCategories();
  // ?kind=service lists bookable services; a service category implies it too.
  // ?kind=service / digital / product narrows the listing; a category implies its kind.
  const kindParam = url.searchParams.get("kind");
  const kind: ProductKind | undefined =
    allCategories.find((c) => c.slug === category)?.kind ??
    (kindParam === "service" || kindParam === "digital" || kindParam === "product" || kindParam === "property"
      ? kindParam
      : // Browsing with nothing chosen means "All products"; a typed search looks everywhere.
        q
        ? undefined
        : "product");
  // Real estate filters
  const listingParam = url.searchParams.get("listing");
  const listingType = kind === "property" && LISTING_TYPES.some((t) => t.value === listingParam) ? (listingParam as ListingType) : undefined;
  const features = kind === "property" ? url.searchParams.getAll("feature").filter((f) => FEATURE_FLAGS.some((x) => x.key === f)) : [];
  const titleDeed = kind === "property" && url.searchParams.get("deed") === "1";
  // Vehicle and spare-part filters, on the Auto category only
  const auto = category === AUTO_CATEGORY_SLUG ? autoFiltersFromParams(url.searchParams) : null;

  const products = await searchProducts({ q, categorySlug: category, sort, kind, inStockOnly: inStock && kind === "product", listingType, features, titleDeed, auto: auto ?? undefined });
  const categories = allCategories.filter((c) => (kind ? c.kind === kind : true));
  const categoryName = categories.find((c) => c.slug === category)?.name;
  const heading = q ? `Results for "${q}"` : (categoryName ?? (kind === "service" ? "Services" : kind === "digital" ? "Digital downloads" : kind === "property" ? "Real Estate" : "All products"));

  const banners = await pageBanners(request, ["category_top", "sidebar"]);
  return { products, categories, q, category, sort, inStock, heading, kind, banners, listingType, features, titleDeed, auto };
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { products, categories, q, category, sort, inStock, heading, kind, banners, listingType, features, titleDeed, auto } = loaderData;
  const submit = useSubmit();

  const chip = (to: string, label: string, active: boolean, Icon?: typeof CarIcon) => (
    <Link
      key={label}
      to={to}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm font-medium transition-colors",
        active ? SUBMENU_CHIP.active : SUBMENU_CHIP.idle,
      )}
    >
      {Icon ? <Icon className="size-4" /> : null}
      {label}
    </Link>
  );
  const categoryChip = (slug: string | undefined, label: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (kind) params.set("kind", kind);
    if (slug) params.set("category", slug);
    return chip(`/search?${params}`, label, category === slug);
  };
  // Auto has its own main menu tab; its submenu is vehicles / spare parts. Switching type clears the other type's filters.
  const autoChip = (type: "vehicle" | "part" | undefined, label: string, Icon?: typeof CarIcon) => {
    const params = new URLSearchParams({ category: AUTO_CATEGORY_SLUG });
    if (q) params.set("q", q);
    if (type) params.set("autoType", type);
    return chip(`/search?${params}`, label, auto?.type === type, Icon);
  };

  return (
    <>
      <Container className="pt-6 md:pt-8">
        <PageHeader title={heading} description={`${products.length} item${products.length === 1 ? "" : "s"}`} />
      </Container>

      {/* Outside the page column so that, pinned to the top, it spans the screen like the main menu. */}
      <StickySubmenu className="mb-4">
        <Container className="scrollbar-none flex gap-2 overflow-x-auto py-2">
          {auto ? (
            <>
              {autoChip(undefined, "Everything in Auto")}
              {autoChip("vehicle", "Vehicles", CarIcon)}
              {autoChip("part", "Spare parts", WrenchIcon)}
            </>
          ) : (
            <>
              {categoryChip(undefined, kind ? ALL_LABEL[kind] : "Everything")}
              {categories.filter((c) => c.slug !== AUTO_CATEGORY_SLUG).map((c) => categoryChip(c.slug, c.name))}
            </>
          )}
        </Container>
      </StickySubmenu>

      <Container className="pb-6 md:pb-8">
        <Form
          className="mb-6 flex flex-wrap items-center gap-4"
          onChange={(e) => submit(e.currentTarget, { preventScrollReset: true })}
        >
          {q ? <input type="hidden" name="q" value={q} /> : null}
          {category ? <input type="hidden" name="category" value={category} /> : null}
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          <label className="flex items-center gap-2 text-sm">
            Sort by
            <NativeSelect name="sort" defaultValue={sort} className="w-auto">
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          {auto ? <AutoFilterFields f={auto} /> : null}
          {kind === "property" ? (
            <>
              <label className="flex items-center gap-2 text-sm">
                Type
                <NativeSelect name="listing" defaultValue={listingType ?? ""} className="w-auto">
                  <option value="">Any</option>
                  {LISTING_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="deed" value="1" defaultChecked={titleDeed} className="size-4 accent-primary" />
                Title deed available
              </label>
              {FEATURE_FLAGS.filter((f) => ["backupPower", "waterTank", "masterEnsuite", "separateDining", "borehole"].includes(f.key)).map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="feature" value={f.key} defaultChecked={features.includes(f.key)} className="size-4 accent-primary" />
                  {f.label.split(" (")[0]}
                </label>
              ))}
            </>
          ) : null}
          {kind !== "service" && kind !== "digital" && kind !== "property" ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="instock" value="1" defaultChecked={inStock} className="size-4 accent-primary" />
              In stock only
            </label>
          ) : null}
        </Form>

        <BannerSlot ads={banners.category_top} shape="leaderboard" className="mb-6" />
        {/* Results and the side ad are separate columns; the results column keeps its own height
            (items-start), so a tall ad never stretches the product cards. */}
        <div className={cn("grid items-start gap-6", banners.sidebar?.length && "lg:grid-cols-[minmax(0,1fr)_300px]")}>
          <div className="min-w-0">
            {products.length ? (
              <ProductGrid products={products} />
            ) : (
              <EmptyState icon={SearchXIcon} title="Nothing found">
                Try another search, or{" "}
                <Link to="/requests/new" className="font-semibold text-primary">
                  post a request
                </Link>{" "}
                and let merchants find it for you.
              </EmptyState>
            )}
          </div>
          <BannerSlot ads={banners.sidebar} shape="sidebar" className="sticky top-36 hidden lg:block" />
        </div>
      </Container>
    </>
  );
}
