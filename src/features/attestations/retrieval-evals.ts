export type RetrievalEvalCase = {
	id: string;
	query: string;
	expectedSourceId: string;
	expectedAnchorPattern: RegExp;
};

export const retrievalEvalCases: RetrievalEvalCase[] = [
	{
		id: "alice-rabbit-hole-watch",
		query: "What does Alice see at the rabbit-hole?",
		expectedSourceId: "alice-in-wonderland",
		expectedAnchorPattern: /watch|waistcoat-pocket|rabbit-hole/i,
	},
	{
		id: "hamlet-mousetrap",
		query: "What is the mousetrap in Hamlet?",
		expectedSourceId: "hamlet",
		expectedAnchorPattern: /play|murder|Vienna|Gonzago/i,
	},
	{
		id: "raskolnikov-alyona-identity",
		query: "Who is Alyona Ivanovna in Crime and Punishment?",
		expectedSourceId: "crime-and-punishment",
		expectedAnchorPattern: /Alyona Ivanovna|pawnbroker/i,
	},
	{
		id: "sherlock-red-headed-league",
		query: "What job does Jabez Wilson get in the Red-Headed League?",
		expectedSourceId: "adventures-of-sherlock-holmes",
		expectedAnchorPattern: /copy|encyclopaedia|red-headed|league/i,
	},
	{
		id: "macbeth-dagger",
		query: "What vision does Macbeth see before killing Duncan?",
		expectedSourceId: "macbeth",
		expectedAnchorPattern: /dagger|Duncan|handle/i,
	},
];
