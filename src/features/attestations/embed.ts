const VECTOR_SIZE = 128;

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"did",
	"do",
	"does",
	"for",
	"from",
	"how",
	"if",
	"in",
	"is",
	"it",
	"of",
	"or",
	"that",
	"the",
	"this",
	"to",
	"was",
	"what",
	"when",
	"where",
	"who",
	"why",
	"with",
]);

export function tokenize(text: string): string[] {
	return (
		text
			.toLowerCase()
			.replace(/n·m/g, "newton meter")
			.match(/[a-z0-9']+/g)
			?.filter((token) => token.length > 1 && !STOP_WORDS.has(token)) ?? []
	);
}

export function embedText(text: string): number[] {
	const vector = Array.from({ length: VECTOR_SIZE }, () => 0);
	const tokens = tokenize(text);

	if (tokens.length === 0) {
		vector[0] = 1;
		return vector;
	}

	for (const [index, token] of tokens.entries()) {
		vector[hashToken(token)] += 1;

		const nextToken = tokens[index + 1];
		if (nextToken) {
			vector[hashToken(`${token}:${nextToken}`)] += 0.35;
		}
	}

	return vector;
}

function hashToken(token: string): number {
	let hash = 2166136261;

	for (let index = 0; index < token.length; index += 1) {
		hash ^= token.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}

	return Math.abs(hash) % VECTOR_SIZE;
}
