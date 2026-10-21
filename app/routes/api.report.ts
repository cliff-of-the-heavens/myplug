import { data } from "react-router";
import { reportTarget } from "~/db/schema";
import { requireUser } from "~/lib/auth.server";
import { fileReport, ReportError } from "~/lib/moderation.server";
import { str } from "~/lib/utils";
import type { Route } from "./+types/api.report";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const targetType = str(form.get("targetType"));
  const targetId = str(form.get("targetId"));

  if (!reportTarget.enumValues.includes(targetType as never) || !UUID.test(targetId)) {
    return data({ error: "Invalid report." }, { status: 400 });
  }
  try {
    await fileReport(user, {
      targetType: targetType as (typeof reportTarget.enumValues)[number],
      targetId,
      reason: str(form.get("reason")),
      details: str(form.get("details")),
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof ReportError) return data({ error: e.message }, { status: 400 });
    throw e;
  }
}
