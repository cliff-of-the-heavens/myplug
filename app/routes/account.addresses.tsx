import { MapPinIcon, PlusIcon, StarIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { AddressFields } from "~/components/address-fields";
import { Container, EmptyState, FormError, PageHeader } from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { AddressError, addressFromForm, deleteAddress, listAddresses, saveAddress } from "~/lib/addresses.server";
import { requireCustomer } from "~/lib/auth.server";
import { isUuid, str } from "~/lib/utils";
import type { Route } from "./+types/account.addresses";

export const meta: Route.MetaFunction = () => [{ title: "Delivery addresses · MyPlug" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireCustomer(request);
  return { addresses: await listAddresses(user.id) };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireCustomer(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const id = str(form.get("id"));
  try {
    if (intent === "delete" && isUuid(id)) {
      await deleteAddress(user.id, id);
      return { ok: "Address removed." };
    }
    if (intent === "default" && isUuid(id)) {
      const current = (await listAddresses(user.id)).find((a) => a.id === id);
      if (current) {
        const { label, recipientName, phone, line1, area, city, landmark } = current;
        await saveAddress(user.id, { label, recipientName, phone, line1, area, city, landmark }, id, true);
      }
      return { ok: "Default address updated." };
    }
    await saveAddress(user.id, addressFromForm(form), isUuid(id) ? id : undefined, form.get("isDefault") === "on");
    return { ok: "Address saved.", saved: true };
  } catch (e) {
    if (e instanceof AddressError) return { error: e.message };
    throw e;
  }
}

export default function Addresses({ loaderData, actionData }: Route.ComponentProps) {
  const { addresses } = loaderData;
  const [editing, setEditing] = useState<string | "new" | null>(addresses.length ? null : "new");
  const busy = useNavigation().state !== "idle";
  const done = actionData && "saved" in actionData;

  return (
    <Container className="max-w-3xl py-8">
      <PageHeader
        title="Delivery addresses"
        description="Save the places you get deliveries, then pick one when you order."
        actions={
          <Button onClick={() => setEditing("new")} variant="outline">
            <PlusIcon /> Add address
          </Button>
        }
      />
      {actionData && "ok" in actionData ? (
        <p className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm font-medium text-success">{actionData.ok}</p>
      ) : null}
      <FormError error={actionData && "error" in actionData ? actionData.error : null} />

      {editing === "new" && !done ? (
        <Card className="mb-4 border-primary/40">
          <CardContent className="pt-5">
            <Form method="post" className="grid gap-4">
              <AddressFields />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isDefault" className="size-4 accent-primary" /> Use as my default address
              </label>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>Save address</Button>
                <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              </div>
            </Form>
          </CardContent>
        </Card>
      ) : null}

      {addresses.length === 0 && editing !== "new" ? (
        <EmptyState icon={MapPinIcon} title="No saved addresses">
          Add one to check out faster.
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {addresses.map((a) => (
            <Card key={a.id}>
              <CardContent className="grid gap-3 pt-5">
                {editing === a.id && !done ? (
                  <Form method="post" className="grid gap-4">
                    <input type="hidden" name="id" value={a.id} />
                    <AddressFields value={a} />
                    <div className="flex gap-2">
                      <Button type="submit" disabled={busy}>Save</Button>
                      <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    </div>
                  </Form>
                ) : (
                  <div className="flex flex-wrap items-start gap-3">
                    <MapPinIcon className="mt-0.5 size-5 text-primary" />
                    <div className="grid flex-1 gap-0.5 text-sm">
                      <p className="flex items-center gap-2 font-bold">
                        {a.label} {a.isDefault ? <Badge variant="success">Default</Badge> : null}
                      </p>
                      <p>{a.recipientName} · {a.phone}</p>
                      <p className="text-muted-foreground">
                        {a.line1}, {a.area}, {a.city}
                        {a.landmark ? ` · ${a.landmark}` : ""}
                      </p>
                    </div>
                    <Form method="post" className="flex flex-wrap gap-1">
                      <input type="hidden" name="id" value={a.id} />
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(a.id)}>Edit</Button>
                      {!a.isDefault ? (
                        <Button type="submit" name="intent" value="default" size="sm" variant="ghost">
                          <StarIcon /> Make default
                        </Button>
                      ) : null}
                      <Button type="submit" name="intent" value="delete" size="sm" variant="ghost" aria-label="Remove">
                        <Trash2Icon />
                      </Button>
                    </Form>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </Container>
  );
}
