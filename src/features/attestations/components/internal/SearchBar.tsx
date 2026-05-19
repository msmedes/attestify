import { Search } from "lucide-react";

type SearchBarProps = {
	query: string;
	isPending: boolean;
	onQueryChanged: (query: string) => void;
	onSubmitted: (query: string) => void;
};

export function SearchBar({
	query,
	isPending,
	onQueryChanged,
	onSubmitted,
}: SearchBarProps) {
	return (
		<form
			className="flex flex-col gap-3 md:flex-row"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmitted(query);
			}}
		>
			<label className="sr-only" htmlFor="query">
				Query
			</label>
			<input
				className="h-12 min-w-0 flex-1 border border-[#20211f] bg-[#f7f7f2] px-4 text-base outline-none transition-colors focus:bg-[#ffffff] focus:ring-2 focus:ring-[#3b6d65] focus:ring-offset-2 focus:ring-offset-[#ffffff]"
				id="query"
				onChange={(event) => onQueryChanged(event.target.value)}
				placeholder="Ask about Hamlet, Raskolnikov, Darcy, Holmes, Alice..."
				value={query}
			/>
			<button
				className="inline-flex h-12 items-center justify-center gap-2 border border-[#20211f] bg-[#20211f] px-5 text-[#ffffff] transition-colors transition-transform hover:bg-[#3b6d65] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-[#3b6d65] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-[#6f716d] disabled:active:scale-100"
				disabled={isPending}
				type="submit"
			>
				<Search aria-hidden="true" size={18} />
				<span>{isPending ? "Searching" : "Search"}</span>
			</button>
		</form>
	);
}
