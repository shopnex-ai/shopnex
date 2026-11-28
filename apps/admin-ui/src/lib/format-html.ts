// Pretty-prints the editor's HTML for its source view (Tiptap writes it on one line). Prettier's HTML formatter is
// whitespace-aware (inline elements and <pre> keep their spaces, so the page renders the same) and is loaded only when someone
// opens the source view. If it cannot format the markup, it is shown as it is.
export async function formatHtml(html: string): Promise<string> {
  if (!html.trim()) return html
  try {
    const [prettier, htmlPlugin] = await Promise.all([import('prettier/standalone'), import('prettier/plugins/html')])
    const formatted = await prettier.format(html, {
      parser: 'html',
      plugins: [htmlPlugin],
      printWidth: 100,
      htmlWhitespaceSensitivity: 'css',
    })
    return formatted.trimEnd()
  } catch {
    return html
  }
}
