import { Copy, Check } from "lucide-react";
import { useState } from "react";

const escapeHTML = (str: string) =>
  str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const highlightCode = (code: string, lang: string) => {
  code = escapeHTML(code); // Escape HTML first
  lang = lang.toLowerCase();

  switch (lang) {
    case "javascript":
    case "typescript":
    case "ts":
      return code
        .replace(
          /\b(const|let|var|function|return|if|else|for|while|switch|case|break|import|from|export|class|new|try|catch|finally)\b/g,
          '<span class="text-blue-400">$1</span>',
        )
        .replace(
          /(".*?"|'.*?'|`.*?`)/g,
          '<span class="text-green-400">$1</span>',
        )
        .replace(/(\d+)/g, '<span class="text-purple-400">$1</span>')
        .replace(/(\/\/.*)/g, '<span class="text-gray-400">$1</span>');

    case "python":
      return code
        .replace(
          /\b(def|return|if|else|elif|for|while|import|from|as|break|class|try|except|with|lambda|pass|yield|in|is|not|and|or)\b/g,
          '<span class="text-blue-400">$1</span>',
        )
        .replace(/(".*?"|'.*?')/g, '<span class="text-green-400">$1</span>')
        .replace(/(\d+)/g, '<span class="text-purple-400">$1</span>')
        .replace(/(#.*)/g, '<span class="text-gray-400">$1</span>');

    case "bash":
    case "cmd":
      return code
        .replace(/(#.*)/g, '<span class="text-gray-400">$1</span>')
        .replace(/(".*?"|'.*?')/g, '<span class="text-green-400">$1</span>')
        .replace(
          /(\$[a-zA-Z_][a-zA-Z0-9_]*)/g,
          '<span class="text-yellow-400">$1</span>',
        )
        .replace(
          /\b(if|then|else|elif|fi|for|while|do|done|echo|exit|function|return)\b/g,
          '<span class="text-blue-200">$1</span>',
        )
        .replace(
          /^(?!\s*#)(\s*\S+)/gm,
          '<span class="text-blue-200 font-semibold">$1</span>',
        );

    case "rust":
      return code
        .replace(
          /\b(fn|let|mut|struct|enum|impl|for|while|loop|if|else|match|mod|use|pub|crate|self|super|as|trait|return|const|static)\b/g,
          '<span class="text-blue-400">$1</span>',
        )
        .replace(/(".*?"|'.*?')/g, '<span class="text-green-400">$1</span>')
        .replace(/(\d+)/g, '<span class="text-purple-400">$1</span>')
        .replace(/(\/\/.*)/g, '<span class="text-gray-400">$1</span>');

    case "markdown":
    case "md":
      return code
        .replace(
          /^(#{1,6}\s.*)$/gm,
          '<span class="text-blue-400 font-bold">$1</span>',
        )
        .replace(
          /(\*\*.*?\*\*|\*.*?\*)/g,
          '<span class="text-purple-400">$1</span>',
        )
        .replace(/(`.*?`)/g, '<span class="text-green-400">$1</span>')
        .replace(/(>.*)/g, '<span class="text-gray-400">$1</span>');

    case "toml":
      return code
        .split("\n")
        .map((line) => {
          const trimmed = line.trim();

          if (trimmed.startsWith("#"))
            return `<span class="text-gray-400">${line}</span>`;
          if (trimmed.startsWith("[") && trimmed.endsWith("]"))
            return `<span class="text-blue-400 font-bold">${line}</span>`;

          const match = line.match(/^(\s*[\w.-]+)\s*=\s*(.*)?$/);
          if (match) {
            const key = `<span class="text-blue-400 font-semibold">${match[1]}</span>`;
            let value = match[2]?.trim() || "";

            if (value.startsWith('"') || value.startsWith("'"))
              value = `<span class="text-green-400">${value}</span>`;
            else if (value === "true" || value === "false")
              value = `<span class="text-purple-400">${value}</span>`;
            else if (value && !isNaN(Number(value)))
              value = `<span class="text-purple-400">${value}</span>`;

            return value ? `${key} = ${value}` : `${key} =`;
          }

          return line;
        })
        .join("\n");

    case "address":
    case "hash":
    case "tx id":
    case "transaction id":
    case "secret key":
    case "private key":
      code = escapeHTML(code); // escape HTML first
      // eslint-disable-next-line
      let highlighted = "";

      for (const char of code) {
        if (/[0-9]/.test(char)) {
          highlighted += `<span class="text-green-300">${char}</span>`; // numbers
        } else {
          highlighted += `<span class="text-green-400">${char}</span>`; // letters
        }
      }

      return highlighted;

    case "json":
      return code
        .replace(/("[^"]*")(\s*:)/g, '<span class="text-blue-400">$1</span>$2') // keys
        .replace(/(:\s*)("[^"]*")/g, '$1<span class="text-green-400">$2</span>') // string values
        .replace(
          /(:\s*)(true|false|null)/g,
          '$1<span class="text-purple-400">$2</span>',
        ) // booleans/null
        .replace(
          /(:\s*)([+-]?\d+(\.\d+)?)/g,
          '$1<span class="text-purple-400">$2</span>',
        );

    default:
      return code;
  }
};

export default function CodeBox({
  code,
  lang,
}: {
  code: string;
  lang: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-[#2e2e2e] p-5 pt-12 relative rounded-xl font-mono">
      <pre
        className="whitespace-pre-wrap overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: highlightCode(code, lang) }}
      ></pre>

      <div
        onClick={handleCopy}
        className="flex items-center gap-2 absolute top-3 right-2 text-gray-200 px-3 py-1 rounded-lg cursor-pointer transition-colors select-none"
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        <span>{copied ? "Copied" : "Copy"}</span>
      </div>

      <div className="text-accent-light/70 absolute top-5 left-5 text-opacity-100">
        {lang}
      </div>
    </div>
  );
}
