import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Tailwind-styled renderers (no @tailwindcss/typography needed) — tuned for chat bubbles, on-brand
 *  stone/sky, dark-mode aware, GFM tables scroll horizontally on mobile. */
// Strip react-markdown's `node` prop so it isn't spread onto DOM elements (React warns otherwise).
const components = {
  h1: ({ node, ...p }: any) => <h2 className="mt-3 mb-1 text-base font-bold first:mt-0" {...p} />,
  h2: ({ node, ...p }: any) => <h3 className="mt-3 mb-1 text-[15px] font-semibold first:mt-0" {...p} />,
  h3: ({ node, ...p }: any) => <h4 className="mt-2 mb-0.5 text-sm font-semibold first:mt-0" {...p} />,
  h4: ({ node, ...p }: any) => <h5 className="mt-2 mb-0.5 text-sm font-semibold first:mt-0" {...p} />,
  p: ({ node, ...p }: any) => <p className="my-1.5 leading-relaxed first:mt-0 last:mb-0" {...p} />,
  strong: ({ node, ...p }: any) => <strong className="font-semibold text-stone-900 dark:text-stone-100" {...p} />,
  em: ({ node, ...p }: any) => <em className="italic" {...p} />,
  ul: ({ node, ...p }: any) => <ul className="my-1.5 list-disc space-y-0.5 pl-5" {...p} />,
  ol: ({ node, ...p }: any) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5" {...p} />,
  li: ({ node, ...p }: any) => <li className="leading-relaxed" {...p} />,
  a: ({ node, ...p }: any) => (
    <a className="text-alpine-600 underline underline-offset-2 dark:text-alpine-400" target="_blank" rel="noreferrer" {...p} />
  ),
  hr: () => <hr className="my-3 border-stone-200 dark:border-stone-700" />,
  blockquote: ({ node, ...p }: any) => (
    <blockquote className="my-2 border-l-2 border-stone-300 pl-3 text-stone-500 dark:border-stone-600 dark:text-stone-400" {...p} />
  ),
  code: ({ node, className, children, ...rest }: any) => {
    const isBlock = /language-/.test(className || "");
    return isBlock ? (
      <code className={`font-mono text-xs ${className ?? ""}`} {...rest}>{children}</code>
    ) : (
      <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-stone-800" {...rest}>{children}</code>
    );
  },
  pre: ({ node, ...p }: any) => <pre className="my-2 overflow-x-auto rounded-lg bg-stone-100 p-3 text-xs dark:bg-stone-800" {...p} />,
  table: ({ node, ...p }: any) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs" {...p} />
    </div>
  ),
  thead: ({ node, ...p }: any) => <thead className="bg-stone-100 dark:bg-stone-800" {...p} />,
  th: ({ node, ...p }: any) => <th className="border border-stone-200 px-2 py-1 text-left font-semibold dark:border-stone-700" {...p} />,
  td: ({ node, ...p }: any) => <td className="border border-stone-200 px-2 py-1 dark:border-stone-700" {...p} />,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[15px] text-stone-700 sm:text-sm dark:text-stone-200">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
