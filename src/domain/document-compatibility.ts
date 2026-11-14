/** Canonical IDs for document links stored in a legacy study record. */
export function documentAssociationIds(value: unknown, ownStudyId: string): string[] {
    if (value == null) return [];
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !/^[\w-]+$/.test(id))) {
        throw new Error('Los vínculos del documento no son válidos.');
    }
    return [...new Set((value as string[]).filter((id) => id !== ownStudyId))];
}
