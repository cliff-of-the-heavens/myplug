import { requireUser } from "~/lib/auth.server";
import { checkMediaLink } from "~/lib/digital.server";
import { privateFileResponse } from "~/lib/storage.server";
import { isUuid } from "~/lib/utils";
import type { Route } from "./+types/media";

/** Streams or downloads a purchased file, for its owner, through a short-lived signed link. */
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  if (!isUuid(params.grantId)) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const file = await checkMediaLink(user.id, params.grantId, url.searchParams.get("p"), url.searchParams.get("e"), url.searchParams.get("t"));
  if (!file) return new Response("This link has expired. Open it again from your library.", { status: 403 });
  const safeName = file.name.replace(/[^\w.\- ]/g, "_");
  return privateFileResponse(file.key, request, {
    "Content-Disposition": file.purpose === "download" ? `attachment; filename="${safeName}"` : "inline",
  });
}
