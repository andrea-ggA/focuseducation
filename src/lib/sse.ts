export async function consumeOpenAiSseStream(
  response: Response,
  onDelta: (chunk: string) => void,
): Promise<void> {
  if (!response.body) throw new Error("Stream non disponibile");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneReceived = false;

  while (!doneReceived) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line || line.startsWith(":")) continue;
      if (!line.startsWith("data: ")) continue;

      const jsonPayload = line.slice(6).trim();
      if (jsonPayload === "[DONE]") {
        doneReceived = true;
        break;
      }

      try {
        const parsed = JSON.parse(jsonPayload);
        const content = parsed.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content.length > 0) onDelta(content);
      } catch {
        // Partial JSON across chunks: re-queue current line and continue reading.
        buffer = line + "\n" + buffer;
        break;
      }
    }
  }
}
