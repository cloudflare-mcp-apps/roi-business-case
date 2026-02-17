export async function loadHtml(
  assets: Fetcher | undefined,
  htmlPath: string
): Promise<string> {
  if (!assets) {
    throw new Error("ASSETS binding not available.");
  }

  const htmlResponse = await assets.fetch(
    new Request(new URL(htmlPath, "https://assets.invalid").toString())
  );

  if (!htmlResponse.ok) {
    throw new Error(`Failed to fetch HTML: ${htmlPath} (status: ${htmlResponse.status})`);
  }

  return await htmlResponse.text();
}
