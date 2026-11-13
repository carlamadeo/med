/** Study type catalogue; relative URL so the app also works when served from a sub-path. */
let cachedTypes: string[] | null = null;

export async function getStudyTypes(): Promise<string[]> {
  if (cachedTypes) return cachedTypes;
  const response = await fetch(`${import.meta.env.BASE_URL}types.json`);
  if (!response.ok) throw new Error('No se pudieron cargar los tipos de estudio.');
  cachedTypes = (await response.json()) as string[];
  return cachedTypes;
}
