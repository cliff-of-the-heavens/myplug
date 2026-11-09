import { requireAdmin } from "~/lib/auth.server";
import { getCopyStatus, runCopyBatch } from "~/lib/storage-copy.server";
import type { Route } from "./+types/api.admin.storage-copy";

/** One short burst of the storage copy, called repeatedly while an admin has System settings open. */
export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  await runCopyBatch({ budgetMs: 15_000, maxFiles: 20 });
  return Response.json(await getCopyStatus());
}
