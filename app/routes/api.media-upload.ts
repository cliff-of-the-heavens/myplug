import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireMerchant } from "~/lib/auth.server";
import { MEDIA_TYPES, MAX_MEDIA_BYTES } from "~/lib/digital";
import type { Route } from "./+types/api.media-upload";

/**
 * Issues short-lived tokens so the browser can upload large media straight to Vercel Blob
 * (Vercel functions can't receive request bodies over 4.5 MB). Full files go to private
 * storage; previews are public.
 */
export async function action({ request }: Route.ActionArgs) {
  await requireMerchant(request);
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        // Full files only under private/media/, previews only under previews/.
        if (!/^(private\/media|previews)\/[\w-]+\.[a-z0-9]+$/i.test(pathname)) throw new Error("Invalid upload path");
        return {
          allowedContentTypes: Object.values(MEDIA_TYPES).flat(),
          maximumSizeInBytes: pathname.startsWith("previews/") ? 200 * 1024 * 1024 : MAX_MEDIA_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
  }
}
