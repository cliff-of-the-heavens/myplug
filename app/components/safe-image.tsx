import { EyeOffIcon, ImageIcon } from "lucide-react";
import { cn } from "~/lib/utils";

/**
 * Renders an uploaded image, or a placeholder when there is none or when
 * moderation has hidden it.
 */
export function SafeImage({
  src,
  alt,
  hidden = false,
  className,
  imgClassName,
}: {
  src: string | null | undefined;
  alt: string;
  hidden?: boolean;
  className?: string;
  imgClassName?: string;
}) {
  if (hidden || !src) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-1 bg-muted text-muted-foreground",
          className,
        )}
      >
        {hidden ? <EyeOffIcon className="size-6" /> : <ImageIcon className="size-8 opacity-50" />}
        {hidden ? <span className="px-2 text-center text-xs">Image hidden pending review</span> : null}
      </div>
    );
  }
  return (
    <div className={cn("overflow-hidden bg-muted", className)}>
      <img src={src} alt={alt} loading="lazy" className={cn("size-full object-cover", imgClassName)} />
    </div>
  );
}
