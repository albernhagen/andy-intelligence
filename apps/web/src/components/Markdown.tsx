import ReactMarkdown, { type Components } from "react-markdown";
import { cn } from "@/lib/utils";

/**
 * Markdown for untrusted ticket text: descriptions, comments and questions, partly agent-written
 * (ADR-0059: UX foundation, row "Markdown"; threat model, SPA row). Safe by construction:
 * - react-markdown builds React elements and never raw HTML: without `rehype-raw` (never add
 *   it), HTML in the source shows as literal text.
 * - Only http, https and mailto URLs survive `safeUrl`; any other link renders as plain text.
 * - No image is ever loaded: an image becomes a link labelled with its alt text.
 * - Links open in a new tab, without an opener or referrer, and show their host.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        "space-y-2 break-words",
        "[&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5",
        "[&_h1]:font-medium [&_h2]:font-medium [&_h3]:font-medium [&_h4]:font-medium",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs",
        "[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_pre_code]:p-0",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_hr]:border-border",
        className,
      )}
    >
      <ReactMarkdown urlTransform={safeUrl} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** The URL if it is absolute http(s) or mailto, else "" (relative, javascript:, data: …). */
export function safeUrl(url: string): string {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol) ? url : "";
  } catch {
    return "";
  }
}

function SafeLink({ href, children }: { href?: string; children: React.ReactNode }) {
  if (!href) return <span>{children}</span>;
  const url = new URL(href);
  return (
    <>
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline">
        {children}
      </a>
      {url.host && <span className="ml-1 text-xs text-muted-foreground">({url.host})</span>}
    </>
  );
}

// Headings are capped at the design's sizes (design.md: "Type"); `node` is dropped from props.
const heading = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
  function Heading({ children }: { children?: React.ReactNode }) {
    return <Tag className="text-sm">{children}</Tag>;
  };

const COMPONENTS: Components = {
  a: ({ href, children }) => <SafeLink href={href}>{children}</SafeLink>,
  img: ({ src, alt }) => (
    <SafeLink href={typeof src === "string" ? src : undefined}>{alt || "image"}</SafeLink>
  ),
  h1: heading("h1"),
  h2: heading("h2"),
  h3: heading("h3"),
  h4: heading("h4"),
  h5: heading("h5"),
  h6: heading("h6"),
};
