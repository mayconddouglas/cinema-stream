import { supabase } from "@/lib/supabase";

function extFromUrl(url: string): string {
  try {
    const clean = new URL(url).pathname.toLowerCase();
    if (clean.endsWith(".png")) return "png";
    if (clean.endsWith(".webp")) return "webp";
    if (clean.endsWith(".avif")) return "avif";
    return "jpg";
  } catch {
    return "jpg";
  }
}

export async function cacheImageToSupabaseStorage(
  sourceUrl: string | undefined,
  objectPrefix: string,
): Promise<string | undefined> {
  if (!sourceUrl || !supabase) return sourceUrl;

  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) return sourceUrl;
    const blob = await response.blob();
    if (!blob.size) return sourceUrl;

    const ext = extFromUrl(sourceUrl);
    const objectPath = `${objectPrefix}-${Date.now()}.${ext}`;

    const { error } = await supabase.storage.from("posters").upload(objectPath, blob, {
      upsert: true,
      contentType: blob.type || `image/${ext}`,
    });

    if (error) return sourceUrl;

    const { data } = supabase.storage.from("posters").getPublicUrl(objectPath);
    return data.publicUrl || sourceUrl;
  } catch {
    return sourceUrl;
  }
}
