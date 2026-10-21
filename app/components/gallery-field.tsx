import { ImagePlusIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "./image-dropzone";

type Item = { key: string; url?: string; preview?: string; error?: string };

/**
 * Several photos (a product gallery or a service portfolio). Each photo is uploaded
 * on its own as soon as it's added; the form then submits the URLs as `name` fields.
 */
export function GalleryField({ name = "gallery", initial = [], max = 8 }: { name?: string; initial?: string[]; max?: number }) {
  const [items, setItems] = useState<Item[]>(initial.map((url) => ({ key: url, url })));
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  function update(key: string, patch: Partial<Item>) {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  async function upload(item: Item, file: File) {
    const body = new FormData();
    body.set("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed");
      update(item.key, { url: data.url });
    } catch (e) {
      update(item.key, { error: e instanceof Error ? e.message : "Upload failed" });
    }
  }

  function add(files: FileList | File[]) {
    setError(null);
    const room = max - items.length;
    const list = Array.from(files);
    if (list.length > room) setError(`You can add up to ${max} photos.`);
    for (const file of list.slice(0, Math.max(0, room))) {
      if (!IMAGE_TYPES.includes(file.type)) {
        setError("Only JPG, PNG, WebP or GIF images can be added.");
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError(`${file.name} is over 4 MB.`);
        continue;
      }
      const item: Item = { key: `${Date.now()}-${Math.random()}`, preview: URL.createObjectURL(file) };
      setItems((l) => [...l, item]);
      void upload(item, file);
    }
  }

  const uploading = items.some((i) => !i.url && !i.error);

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {items.map((i) => (
          <div key={i.key} className="relative aspect-square overflow-hidden rounded-xl border bg-muted">
            <img src={i.url ?? i.preview} alt="" className={cn("size-full object-cover", !i.url && "opacity-50")} />
            {!i.url && !i.error ? <LoaderCircleIcon className="absolute inset-0 m-auto size-6 animate-spin text-primary" /> : null}
            {i.error ? <p className="absolute inset-x-0 bottom-0 bg-destructive/90 p-1 text-[10px] text-white">{i.error}</p> : null}
            {i.url ? <input type="hidden" name={name} value={i.url} /> : null}
            <button
              type="button"
              aria-label="Remove photo"
              onClick={() => setItems((l) => l.filter((x) => x.key !== i.key))}
              className="absolute top-1 right-1 rounded-full bg-foreground/80 p-0.5 text-background"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        ))}
        {items.length < max ? (
          <label
            onDragEnter={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              depth.current++;
              setDragging(true);
            }}
            onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
            onDragLeave={() => {
              depth.current = Math.max(0, depth.current - 1);
              if (!depth.current) setDragging(false);
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.types.includes("Files")) return;
              e.preventDefault();
              depth.current = 0;
              setDragging(false);
              add(e.dataTransfer.files);
            }}
            className={cn(
              "grid aspect-square cursor-pointer place-items-center rounded-xl border-2 border-dashed bg-muted/40 text-center text-xs text-muted-foreground hover:border-primary",
              dragging && "border-primary bg-primary/10",
            )}
          >
            <span className="grid justify-items-center gap-1 p-2">
              <ImagePlusIcon className="size-6 text-primary" />
              {dragging ? "Drop photos" : "Add photos"}
            </span>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={IMAGE_TYPES.join(",")}
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) add(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        ) : null}
      </div>
      {uploading ? <p className="text-xs text-muted-foreground">Uploading… wait for it to finish before saving.</p> : null}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
