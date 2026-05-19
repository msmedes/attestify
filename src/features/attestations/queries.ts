import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	answerWithAttestations,
	getQueryHistoryRun,
	listQueryHistory,
} from "./api";

export function useSearchAttestations() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: answerWithAttestations,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["query-history"] });
		},
	});
}

export function useQueryHistory() {
	return useQuery({
		queryKey: ["query-history"],
		queryFn: listQueryHistory,
	});
}

export function useQueryHistoryRun(id: string | null) {
	return useQuery({
		queryKey: ["query-history-run", id],
		queryFn: () => getQueryHistoryRun(id ?? ""),
		enabled: Boolean(id),
	});
}
