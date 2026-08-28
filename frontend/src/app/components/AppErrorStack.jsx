function cleanErrorMessage(message) {
  const text = String(message || "");
  if (!/<html[\s>]/i.test(text) && !/<!doctype html/i.test(text)) return text;
  const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const heading = text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "";
  const exception = text.match(/<pre[^>]*class=["'][^"']*exception_value[^"']*["'][^>]*>([\s\S]*?)<\/pre>/i)?.[1] || "";
  const summary = [heading || title, exception]
    .map((part) => part.replace(/<[^>]+>/g, " ").replace(/&quot;/g, "\"").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" - ");
  return summary || "The server returned an HTML error page.";
}

function AppErrorStack({ messages = [] }) {
  return messages
    .filter(Boolean)
    .map((message, index) => {
      const cleanMessage = cleanErrorMessage(message);
      return (
        <div className="error-box" key={`${index}-${cleanMessage}`}>
          {cleanMessage}
        </div>
      );
    });
}

export default AppErrorStack;
