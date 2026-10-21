import { SearchXIcon } from "lucide-react";
import { Form, Link, useSubmit } from "react-router";
import { Container, EmptyState, PageHeader } from "~/components/page";
import { ProductGrid } from "~/components/product-card";
import { NativeSelect } from "~/components/ui/input";
import type { ProductKind } from "~/db/schema";
import { getCategories, searchProducts, type SortKey } from "~/lib/catalog.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/search";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
];

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
    (kindParam === "service" || kindParam === "digital" || kindParam === "product" ? kindParam : undefined);

  const products = await searchProducts({ q, categorySlug: category, sort, kind, inStockOnly: inStock && kind === "product" });
  const categories = allCategories.filter((c) => (kind ? c.kind === kind : true));
  const categoryName = categories.find((c) => c.slug === category)?.name;
  const heading = q ? `Results for "${q}"` : (categoryName ?? (kind === "service" ? "Services" : kind === "digital" ? "Digital downloads" : "All products"));

  return { products, categories, q, category, sort, inStock, heading, kind };
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { products, categories, q, category, sort, inStock, heading, kind } = loaderData;
  const submit = useSubmit();

  const chip = (slug: string | undefined, label: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (kind) params.set("kind", kind);
    if (slug) params.set("category", slug);
    return (
      <Link
        key={label}
        to={`/search?${params}`}
        className={cn(
          "shrink-0 rounded-full border-2 px-3 py-1 text-sm font-medium",
          category === slug ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/40",
        )}
      >
        {label}
      </Link>
    );
  };

  return (
    <Container className="py-6 md:py-8">
      <PageHeader title={heading} description={`${products.length} item${products.length === 1 ? "" : "s"}`} />

      <div className="scrollbar-none -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {chip(undefined, "All")}
        {categories.map((c) => chip(c.slug, c.name))}
      </div>

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
        {kind !== "service" && kind !== "digital" ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="instock" value="1" defaultChecked={inStock} className="size-4 accent-primary" />
            In stock only
          </label>
        ) : null}
      </Form>

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
    </Container>
  );
}
