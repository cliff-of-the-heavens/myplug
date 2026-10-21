import { FileTextIcon, ImagePlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";

/** Must match the checks in app/lib/upload.server.ts. */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const PROOF_TYPES = [...IMAGE_TYPES, "application/pdf"];
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function hasFiles(e: React.DragEvent) {
  return e.dataTransfer.types.includes("Files");
}

/**
 * Drag-and-drop support for a regular file input. A dropped image is put into
 * the input, so it submits with the form exactly like a picked one.
 */
export function useImageDrop(
  inputRef: React.RefObject<HTMLInputElement | null>,
  onFile: (file: File | null) => void,
  types: string[] = IMAGE_TYPES,
) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const depth = useRef(0); // dragenter/leave also fire for child elements

  function accept(file: File, input: HTMLInputElement | null) {
    if (!types.includes(file.type)) {
      setError(
        types.includes("application/pdf")
          ? "Use a PDF or an image (JPG, PNG, WebP or GIF)."
          : "That isn't a supported image. Use JPG, PNG, WebP or GIF.",
      );
      return false;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("That file is over 4 MB. Please use a smaller one.");
      return false;
    }
    setError(null);
    if (input) {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
    }
    onFile(file);
    return true;
  }

  const handlers = {
    onDragEnter(e: React.DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    },
    onDragOver(e: React.DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave(e: React.DragEvent) {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop(e: React.DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) accept(file, inputRef.current);
    },
  };

  /** For the input's onChange, so picked files get the same checks as dropped ones. */
  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && accept(file, null)) return;
    e.target.value = "";
    onFile(null);
  }

  return { dragging, error, setError, handlers, onInputChange };
}

/** Object URL preview for a chosen file, revoked when replaced or unmounted. */
export function useFilePreview(initial: string | null = null) {
  const [preview, setPreview] = useState<string | null>(initial);
  const objectUrl = useRef<string | null>(null);
  useEffect(() => () => void (objectUrl.current && URL.revokeObjectURL(objectUrl.current)), []);

  function show(file: File | null) {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = file ? URL.createObjectURL(file) : null;
    setPreview(objectUrl.current ?? initial);
  }
  return [preview, show] as const;
}

/** A click-or-drop file picker with a preview, used inside a multipart form. Images by default. */
export function ImageDropzone({
  name = "image",
  required,
  capture,
  defaultPreview = null,
  prompt = "Add photo",
  hint = "Drag & drop or click · JPG, PNG, WebP or GIF up to 4 MB",
  className,
  imgClassName = "size-full object-cover",
  types = IMAGE_TYPES,
}: {
  name?: string;
  required?: boolean;
  capture?: "user" | "environment";
  defaultPreview?: string | null;
  prompt?: string;
  hint?: string;
  className?: string;
  imgClassName?: string;
  types?: string[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, show] = useFilePreview(defaultPreview);
  const [document, setDocument] = useState<string | null>(null); // name of a chosen non-image file
  const { dragging, error, handlers, onInputChange } = useImageDrop(
    inputRef,
    (file) => {
      const isImage = !file || file.type.startsWith("image/");
      setDocument(isImage ? null : file.name);
      show(isImage ? file : null);
    },
    types,
  );

  return (
    <div className="grid gap-1.5">
      <label
        {...handlers}
        className={cn(
          "relative grid cursor-pointer place-items-center overflow-hidden rounded-2xl border-2 border-dashed bg-muted/40 transition-colors hover:border-primary focus-within:border-primary focus-within:ring-[3px] focus-within:ring-ring/30",
          dragging && "border-primary bg-primary/10",
          className,
        )}
      >
        {document ? (
          <span className="flex flex-col items-center gap-2 p-4 text-center">
            <FileTextIcon className="size-10 text-primary" />
            <span className="text-sm font-semibold break-all">{document}</span>
          </span>
        ) : preview ? (
          <img src={preview} alt="Selected" className={imgClassName} />
        ) : (
          <span className="flex flex-col items-center gap-2 p-4 text-center text-muted-foreground">
            <ImagePlusIcon className="size-10 text-primary" />
            <span className="text-sm font-semibold">{prompt}</span>
            {hint ? <span className="text-xs">{hint}</span> : null}
          </span>
        )}
        {dragging ? (
          <span className="absolute inset-0 grid place-items-center bg-primary/15 text-sm font-bold text-primary backdrop-blur-[2px]">
            {types === IMAGE_TYPES ? "Drop image here" : "Drop file here"}
          </span>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          name={name}
          required={required}
          capture={capture}
          accept={types.join(",")}
          className="sr-only"
          onChange={onInputChange}
        />
      </label>
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
