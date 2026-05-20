export function citationElementId(citationHandle: string): string {
	return `citation-${citationHandle.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
