import { CheckCircle2Icon, UploadCloudIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "~/lib/utils";

/**
 * Upload field for large media. With `direct`, the file goes straight from the browser to
 * Vercel Blob (no 4.5 MB request limit) and only its key is submitted with the form.
 * Otherwise the file itself is submitted as `name`.
 */
export function MediaUploadField({
  name,
  keyName,
  direct,
  accept,
  visibility,
  current,
}: {
  name: string; // form field for a normal upload
  keyName: string; // form field holding the uploaded key/URL in direct mode
  direct: boolean;
  accept: string[];
  visibility: "private" | "public";
  current?: string | null;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function uploadDirect(file: File) {
    setError(null);
    setFileName(file.name);
    setProgress(0);
    try {
      const { upload } = await import("@vercel/blob/client");
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const folder = visibility === "private" ? "private/media" : "previews";
      const blob = await upload(`${folder}/${crypto.randomUUID()}.${ext}`, file, {
        access: visibility,
        handleUploadUrl: "/api/media-upload",
        multipart: file.size > 50 * 1024 * 1024,
        onUploadProgress: (p) => setProgress(Math.round(p.percentage)),
      });
      setValue(visibility === "private" ? `blob:${blob.pathname}` : blob.url);
      setProgress(100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setProgress(null);
    }
  }

  return (
    <div className="grid gap-1.5">
      <label
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed p-3 text-sm hover:border-primary",
          value && "border-success bg-success/5",
        )}
      >
        {value ? <CheckCircle2Icon className="size-6 text-success" /> : <UploadCloudIcon className="size-6 text-primary" />}
        <span className="grid min-w-0">
          <span className="truncate font-semibold">{fileName ?? (current ? "Uploaded. Choose a file to replace it" : "Choose a file")}</span>
          <span className="text-xs text-muted-foreground">{accept.map((a) => a.split("/")[1]).join(", ")}</span>
        </span>
        <input
          type="file"
          accept={accept.join(",")}
          name={direct ? undefined : name}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (direct) void uploadDirect(file);
            else setFileName(file.name);
          }}
        />
      </label>
      {direct ? <input type="hidden" name={keyName} value={value} /> : null}
      {progress !== null && progress < 100 ? (
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      {progress !== null && progress < 100 ? <p className="text-xs text-muted-foreground">Uploading {progress}%… wait for it to finish before saving.</p> : null}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
      {!direct ? <p className="text-xs text-muted-foreground">Large files need Vercel Blob storage (Admin → System settings).</p> : null}
    </div>
  );
}
