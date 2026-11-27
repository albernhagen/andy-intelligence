import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * The board's filter box (AI-400): narrows every lane to tickets whose key, title or epic title
 * holds the text. Typing updates `onChange` at once (the URL keeps it, `?q=`); Escape clears it.
 * Board shortcuts never fire while typing here (`isTyping`), and Cmd+K still opens the palette.
 */
export function BoardFilter({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (text: string) => void;
  className?: string;
}) {
  // Local text so typing never waits on the router; the URL wins when it changes (back button).
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const change = (next: string) => {
    setText(next);
    onChange(next);
  };
  return (
    <div className={`relative ${className ?? ""}`}>
      <Search
        className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        aria-label="Filter tickets"
        placeholder="Filter by key, title or epic"
        value={text}
        maxLength={200}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape" || !text) return;
          // Taken here, so Escape clears the box and doesn't also close an open ticket panel.
          e.preventDefault();
          e.stopPropagation();
          change("");
        }}
        className="h-11 pl-7 text-base sm:h-8 sm:w-56 sm:text-sm"
      />
    </div>
  );
}
